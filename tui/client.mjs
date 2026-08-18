#!/usr/bin/env node
/**
 * eve-coder TUI — a pi-caliber terminal client for the prebuilt eve server.
 *
 * Rendering: @earendil-works/pi-tui (the library pi's own shell is built on).
 * Agent protocol: eve/client — durable sessions, resume via attach(), context
 * compaction, clears, cooperative cancellation, and HITL input requests.
 *
 * Layout, top to bottom: transcript → status line → editor → footer.
 *
 * Env:
 *   EVE_CODER_SERVER_URL  (required) the eve server base URL
 *   LOCAL_CODER_ROOT      (optional) workspace path, shown in the banner
 */
import { join } from "node:path";
import { Client } from "eve/client";
import {
  CombinedAutocompleteProvider,
  Editor,
  ProcessTerminal,
  Text,
  TuiMainScreen,
  isKeyRelease,
  matchesKey,
} from "@earendil-works/pi-tui";
import { color, sty } from "./theme.mjs";
import { DEFAULT_EFFORT, DEFAULT_MODEL, loadPrefs, savePrefs, stateDir } from "./runtime-config.mjs";
import { Transcript, spinner } from "./transcript.mjs";
import { Footer, StatusLine, banner } from "./footer.mjs";
import { createEventHandler } from "./events.mjs";
import { buildCommands, parseCommand, parseToggle } from "./commands.mjs";
import { findSession, labelFor, loadSessions, removeSession, saveSession } from "./sessions.mjs";

const WORKSPACE = process.env.LOCAL_CODER_ROOT ?? process.cwd();
/** Spinner tick. Fast enough to look alive, slow enough to not thrash renders. */
const SPINNER_INTERVAL_MS = 80;

// ---------------------------------------------------------------------------
// Mutable shell state
// ---------------------------------------------------------------------------
const serverUrl = process.env.EVE_CODER_SERVER_URL;
let client = null;
let session = null; // ClientSession | null
let tui = null;
let terminal = null;
let editor = null;
let transcript = null;
let footer = null;
let status = null;
let handleEvent = null;
let commands = [];
let busy = false;
let pendingRequests = [];
let firstUserMessage = null;
let prefs = loadPrefs();
let spinnerTimer = null;

function requestRender() {
  tui?.requestRender();
}

/** Run the spinner clock only while something is actually in flight. */
function syncSpinner() {
  const active = busy || transcript?.hasPending();
  if (active && !spinnerTimer) {
    spinnerTimer = setInterval(() => {
      spinner.frame += 1;
      requestRender();
    }, SPINNER_INTERVAL_MS);
    spinnerTimer.unref?.();
  } else if (!active && spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    requestRender();
  }
}

function setBusy(next) {
  busy = next;
  syncSpinner();
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------
function persistSession(state) {
  if (!state?.sessionId) return;
  saveSession({
    id: state.sessionId,
    streamIndex: state.streamIndex,
    label: labelFor(firstUserMessage, state.sessionId.slice(0, 8)),
    cwd: WORKSPACE,
    ts: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Stream consumption
// ---------------------------------------------------------------------------
async function consume(response) {
  try {
    for await (const event of response) handleEvent(event);
  } catch (err) {
    transcript.notice(`✗ stream error: ${err?.message ?? err}`, "error");
  } finally {
    setBusy(false);
    if (session) persistSession(session.state);
    if (pendingRequests.length === 0) status.clear();
    requestRender();
  }
}

/** Follow the live stream until the session reaches a quiet point. */
async function followToBoundary() {
  if (!session) return;
  try {
    for await (const event of session.stream({ follow: true })) {
      handleEvent(event);
      if (
        event.type === "session.waiting" ||
        event.type === "session.completed" ||
        event.type === "session.failed"
      ) {
        return;
      }
    }
  } catch (err) {
    transcript.notice(`✗ stream error: ${err?.message ?? err}`, "error");
  } finally {
    setBusy(false);
  }
}

async function sendTurn(text) {
  firstUserMessage = firstUserMessage ?? text;
  transcript.addUser(text);
  status.set("sending", { busy: true });
  setBusy(true);
  try {
    let response;
    if (session) {
      response = await session.send(text);
    } else {
      const created = await client.sessions.create({ message: text });
      session = created.session;
      response = created.response;
      footer.setSessionId(session.state.sessionId);
    }
    await consume(response);
  } catch (err) {
    transcript.notice(`✗ send failed: ${err?.message ?? err}`, "error");
    setBusy(false);
    status.clear();
  }
}

/**
 * Answer a pending HITL request.
 *
 * eve expects `{requestId, optionId?, text?}`. When the request offers options,
 * a bare number or an exact label picks one; anything else is sent as free text
 * (which the request must allow).
 */
async function answerPendingInput(text) {
  const requests = pendingRequests;
  pendingRequests = [];
  transcript.addUser(text);
  status.set("answering", { busy: true });
  setBusy(true);
  try {
    const responses = requests.map((request) => {
      const options = Array.isArray(request.options) ? request.options : [];
      if (options.length > 0) {
        const index = /^\d+$/.test(text) ? Number.parseInt(text, 10) - 1 : -1;
        const picked =
          options[index] ??
          options.find((o) => (o.label ?? "").toLowerCase() === text.toLowerCase()) ??
          options.find((o) => o.id === text);
        if (picked) return { requestId: request.requestId, optionId: picked.id };
      }
      return { requestId: request.requestId, text };
    });
    await consume(await session.respond(responses));
  } catch (err) {
    transcript.notice(`✗ answer failed: ${err?.message ?? err}`, "error");
    setBusy(false);
    status.clear();
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const app = {
  get transcript() {
    return transcript;
  },
  get footer() {
    return footer;
  },
  get status() {
    return status;
  },
  setBusy,
  setPendingRequests(requests) {
    pendingRequests = requests ?? [];
  },
  onSessionFailed(sessionId) {
    removeSession(sessionId);
    session = null; // the next message starts a fresh session
  },

  help() {
    transcript.notice("commands", "accent");
    for (const cmd of commands) {
      const name = `/${cmd.name}${cmd.argumentHint ? ` ${cmd.argumentHint}` : ""}`;
      transcript.notice(`  ${color("cyan", name.padEnd(30))}${color("dim", cmd.description ?? "")}`, "text");
    }
    transcript.notice("keys", "accent");
    for (const [key, what] of [
      ["enter", "send · shift+enter or \\+enter for a newline"],
      ["tab", "accept the highlighted completion"],
      ["@", "complete a file path"],
      ["ctrl+o", "expand / collapse tool output and reasoning"],
      ["ctrl+r", "show / hide reasoning traces"],
      ["esc", "interrupt the current turn"],
      ["ctrl+c", "cancel a turn, or exit when idle"],
      ["ctrl+d", "exit"],
      ["ctrl+l", "redraw the screen"],
      ["↑ / ↓", "prompt history"],
    ]) {
      transcript.notice(`  ${color("cyan", key.padEnd(30))}${color("dim", what)}`, "text");
    }
  },

  newSession() {
    if (session) session.reset({ reason: "new session requested" }).catch(() => {});
    session = null;
    firstUserMessage = null;
    pendingRequests = [];
    transcript.clear();
    footer.reset();
    footer.setSessionId(null);
    handleEvent.resetSeen();
    transcript.notice("— new session —", "success");
  },

  listSessions() {
    const list = loadSessions();
    if (list.length === 0) {
      transcript.notice("(no saved sessions yet)", "muted");
      return;
    }
    list.forEach((s, i) => {
      const when = new Date(s.ts ?? Date.now()).toISOString().slice(0, 16).replace("T", " ");
      transcript.notice(
        `${String(i + 1).padStart(2)} ${color("muted", s.id.slice(0, 12))} ${color("dim", when)} ${s.label ?? ""}`,
        "text",
      );
    });
    transcript.notice("/resume <number|id-prefix> to reopen one", "dim");
  },

  async resume(arg) {
    const target = findSession(arg);
    if (!target) {
      transcript.notice(
        loadSessions().length === 0
          ? "(no saved sessions to resume)"
          : `no session matching "${arg ?? ""}" — try /sessions`,
        "warning",
      );
      return;
    }
    try {
      transcript.clear();
      footer.reset();
      handleEvent.resetSeen();
      transcript.notice(`↩ resuming ${target.id.slice(0, 12)} · ${target.label ?? ""}`, "cyan");
      status.set("loading history", { busy: true });

      // Replay from the start so the transcript matches the session, then
      // attach at the snapshot's cursor to follow only what comes next.
      const snapshot = await client.sessions.attach(target.id, { streamIndex: 0 }).snapshot();
      for (const event of snapshot.events) handleEvent(event);
      session = client.sessions.attach(target.id, {
        streamIndex: snapshot.session.streamIndex,
      });
      footer.setSessionId(target.id);
      firstUserMessage = target.label ?? null;
      setBusy(false);
      status.clear();
      transcript.notice("— resumed —", "success");
    } catch (err) {
      transcript.notice(`✗ resume failed: ${err?.message ?? err}`, "error");
      session = null;
      status.clear();
    }
  },

  // Model and effort are baked into the build by `eve build` (verified: the built
  // server ignores env overrides), so these report what the server compiled in.
  showModel() {
    transcript.notice(`model ${color("accent", footer.model || DEFAULT_MODEL)}`, "text");
    transcript.notice("baked in at build time — edit agent/agent.ts and rebuild to change", "dim");
  },

  showEffort() {
    transcript.notice(`reasoning effort ${color("accent", footer.effort || DEFAULT_EFFORT)}`, "text");
    transcript.notice("baked in at build time — edit agent/agent.ts and rebuild to change", "dim");
  },

  setShowReasoning(arg) {
    const next = parseToggle(arg, prefs.showReasoning);
    if (next === null) {
      transcript.notice(`unknown value "${arg}" — use on or off`, "warning");
      return;
    }
    prefs = savePrefs({ showReasoning: next });
    transcript.setShowReasoning(next);
  },

  setExpanded(arg) {
    const next = parseToggle(arg, prefs.expandTools);
    if (next === null) {
      transcript.notice(`unknown value "${arg}" — use on or off`, "warning");
      return;
    }
    prefs = savePrefs({ expandTools: next });
    transcript.setExpanded(next);
  },

  async listTools() {
    try {
      const info = await client.info();
      const available = info?.tools?.available ?? [];
      if (available.length === 0) {
        transcript.notice("(no tools reported)", "muted");
        return;
      }
      transcript.notice(`${available.length} tools`, "accent");
      for (const tool of available) {
        transcript.notice(
          `  ${color("cyan", tool.name.padEnd(14))}${color("dim", tool.description?.split("\n")[0] ?? "")}`,
          "text",
        );
      }
    } catch (err) {
      transcript.notice(`✗ could not read tools: ${err?.message ?? err}`, "error");
    }
  },

  async compact() {
    if (!session) {
      transcript.notice("(no active session to compact)", "muted");
      return;
    }
    status.set("compacting", { busy: true });
    setBusy(true);
    try {
      const res = await session.compact();
      if (res.status !== "accepted") {
        transcript.notice(`(compaction ${res.status})`, "muted");
        return;
      }
      await followToBoundary();
    } catch (err) {
      transcript.notice(`✗ compact failed: ${err?.message ?? err}`, "error");
    } finally {
      setBusy(false);
      status.clear();
    }
  },

  async clearHistory() {
    if (!session) {
      transcript.notice("(no active session to clear)", "muted");
      return;
    }
    status.set("clearing history", { busy: true });
    setBusy(true);
    try {
      const res = await session.clear();
      if (res.status === "no_active_session") {
        transcript.notice("(no active session)", "muted");
        return;
      }
      await followToBoundary();
      transcript.clear();
      footer.reset();
      transcript.notice("— history cleared —", "success");
    } catch (err) {
      transcript.notice(`✗ clear failed: ${err?.message ?? err}`, "error");
    } finally {
      setBusy(false);
      status.clear();
    }
  },

  cancel() {
    if (!busy) {
      transcript.notice("(nothing to cancel)", "muted");
      return;
    }
    status.set("cancelling", { busy: true });
    session?.cancel().catch((err) => {
      transcript.notice(`✗ cancel failed: ${err?.message ?? err}`, "error");
    });
  },

  quit,
};

async function runCommand(raw) {
  const parsed = parseCommand(raw);
  if (!parsed) return;
  const cmd = commands.find((c) => c.name === parsed.name);
  if (!cmd) {
    transcript.notice(`unknown command /${parsed.name} — try /help`, "warning");
    return;
  }
  try {
    await cmd.run(parsed.arg);
  } catch (err) {
    transcript.notice(`✗ /${parsed.name} failed: ${err?.message ?? err}`, "error");
  }
  requestRender();
}

function quit() {
  if (spinnerTimer) clearInterval(spinnerTimer);
  try {
    tui?.stop();
  } catch {
    /* the terminal is being torn down anyway */
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function editorTheme() {
  return {
    borderColor: (t) => color("borderMuted", t),
    selectList: {
      selectedPrefix: (t) => color("accent", t),
      selectedText: (t) => color("accent", sty.bold(t)),
      description: (t) => color("dim", t),
      scrollInfo: (t) => color("dim", t),
      noMatch: (t) => color("muted", t),
    },
  };
}

async function main() {
  if (!serverUrl) {
    console.error("eve-coder TUI: EVE_CODER_SERVER_URL is required.");
    process.exit(1);
  }

  client = new Client({ host: serverUrl });
  let info = null;
  try {
    await client.health();
    info = await client.info().catch(() => null);
  } catch (err) {
    console.error(`eve-coder TUI: cannot reach eve server at ${serverUrl}: ${err?.message ?? err}`);
    process.exit(1);
  }

  terminal = new ProcessTerminal();
  tui = new TuiMainScreen(terminal, true, join(stateDir(), "logs"));

  transcript = new Transcript(requestRender);
  transcript.showReasoning = prefs.showReasoning;
  transcript.expanded = prefs.expandTools;

  // The server is authoritative for both: `model` and `reasoning` are static
  // agent fields it resolved at boot from the launcher's flags.
  const model = info?.agent?.model?.id ?? DEFAULT_MODEL;
  const effort = info?.agent?.model?.reasoning ?? DEFAULT_EFFORT;
  footer = new Footer({ model, effort, workspace: WORKSPACE });
  if (info?.agent?.model?.contextWindowTokens) {
    footer.setContextWindow(info.agent.model.contextWindowTokens);
  }
  status = new StatusLine();
  handleEvent = createEventHandler(app);
  commands = buildCommands(app);

  editor = new Editor(tui, editorTheme(), { paddingX: 1 });
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commands, WORKSPACE, null));
  editor.onSubmit = async (value) => {
    const text = String(value ?? "").trim();
    if (text.length === 0) return;
    editor.addToHistory(text);
    if (pendingRequests.length > 0) {
      await answerPendingInput(text);
      return;
    }
    if (text.startsWith("/")) {
      await runCommand(text);
      return;
    }
    await sendTurn(text);
  };

  tui.addChild(transcript.container);
  tui.addChild(status);
  tui.addChild(editor);
  tui.addChild(footer);

  tui.addInputListener((data) => {
    // Under the Kitty keyboard protocol, each keypress also emits a release
    // event that matchesKey() matches (by design — see isKeyRelease()). The
    // actions below are press-only, so drop releases here and let the TUI's
    // central release filter handle them.
    if (isKeyRelease(data)) return undefined;
    // Let the editor own escape while its completion popup is open.
    if (matchesKey(data, "escape") && !editor.isShowingAutocomplete()) {
      if (busy) {
        app.cancel();
        return { consume: true };
      }
      return undefined;
    }
    if (matchesKey(data, "ctrl+c")) {
      if (busy) app.cancel();
      else quit();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+d")) {
      if (editor.getText().length === 0) quit();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+l")) {
      terminal.clearScreen();
      requestRender();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+o")) {
      app.setExpanded(!prefs.expandTools);
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+r")) {
      app.setShowReasoning(!prefs.showReasoning);
      return { consume: true };
    }
    return undefined;
  });

  tui.setFocus(editor);
  tui.start();

  transcript.append(new Text(banner(model, effort, WORKSPACE), 1, 0));
  requestRender();

  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => quit());
}

main().catch((err) => {
  console.error("eve-coder TUI crashed:", err);
  process.exit(1);
});
