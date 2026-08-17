#!/usr/bin/env node
/**
 * eve-coder TUI — a pi-caliber terminal client for the prebuilt eve server.
 *
 * Rendering: @earendil-works/pi-tui (the library pi's own shell is built on).
 * Agent protocol: eve/client — durable sessions, resume via attach(), context
 * compaction, clears, cooperative cancellation, ask_question (HITL).
 *
 * Env:
 *   EVE_CODER_SERVER_URL  (required) the eve start server host
 *   LOCAL_CODER_ROOT      (optional) displayed workspace path
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "eve/client";
import {
  Container,
  Input,
  Markdown,
  ProcessTerminal,
  Spacer,
  Text,
  TuiMainScreen,
  matchesKey,
} from "@earendil-works/pi-tui";
import { color, makeMarkdownTheme, paintOn, sty } from "./theme.mjs";

const SERVER_URL = process.env.EVE_CODER_SERVER_URL;
const WORKSPACE = process.env.LOCAL_CODER_ROOT ?? "";
const MAX_STORED_SESSIONS = 50;
const COMMANDS = ["/new", "/resume", "/sessions", "/compact", "/clear", "/cancel", "/help", "/quit"];

// ---------------------------------------------------------------------------
// Session catalog (persisted locally for /sessions + /resume across runs)
// ---------------------------------------------------------------------------
function stateDir() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const dir = join(base, "eve-coder");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return dir;
}
const SESSIONS_FILE = join(stateDir(), "sessions.json");

function loadSessions() {
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveSession(entry) {
  const list = loadSessions().filter((s) => s.id !== entry.id);
  list.unshift(entry);
  writeFileSync(SESSIONS_FILE, JSON.stringify(list.slice(0, MAX_STORED_SESSIONS), null, 2));
}
function removeSession(id) {
  if (!id) return;
  const list = loadSessions().filter((s) => s.id !== id);
  writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
}

// ---------------------------------------------------------------------------
// Transcript rendering (retained components; only the live assistant block is
// rebuilt in place).
// ---------------------------------------------------------------------------
const theme = makeMarkdownTheme();
let tui = null;
let chatContainer = null;
let input = null;
let statusLine = null;
let liveAssistant = null; // the Markdown component currently streaming text

function requestRender() {
  tui?.requestRender();
}
function appendComponent(comp) {
  chatContainer.addChild(comp);
  liveAssistant = null;
  requestRender();
}
function appendUser(text) {
  appendComponent(new Text(paintOn("userMsgBg", `${sty.bold(" you ")} ${text}`, "text"), 0, 0));
}
function appendChat(text, color) {
  appendComponent(new Text(sty[color] ? sty[color](text) : text, 1, 0));
}
function appendAssistantDelta(soFar) {
  const kids = chatContainer.children;
  if (liveAssistant && kids[kids.length - 1] === liveAssistant) {
    const next = new Markdown(soFar, 1, 0, theme);
    chatContainer.removeChild(liveAssistant);
    chatContainer.addChild(next);
    liveAssistant = next;
  } else {
    liveAssistant = new Markdown(soFar, 1, 0, theme);
    chatContainer.addChild(liveAssistant);
  }
  requestRender();
}
function closeAssistant() {
  if (!liveAssistant) return;
  liveAssistant = null;
  chatContainer.addChild(new Spacer(1));
  requestRender();
}
function appendTool(toolName) {
  appendChat(`⚙ ${toolName}`, "dim");
}function setStatus(text) {
  if (!statusLine || !tui) return;
  const next = new Text(text, 0, 0);
  tui.removeChild(statusLine);
  statusLine = next;
  tui.addChild(statusLine); // status stays the last child
  requestRender();
}

// ---------------------------------------------------------------------------
// eve client + session lifecycle
// ---------------------------------------------------------------------------
let client = null;
let session = null; // ClientSession | null
let busy = false;
let awaitingInput = false;
let pendingRequests = [];
let firstUserMessage = null;

function persist(ss) {
  if (!ss) return;
  const label = firstUserMessage
    ? firstUserMessage.length > 70
      ? `${firstUserMessage.slice(0, 70)}…`
      : firstUserMessage
    : ss.sessionId.slice(0, 8);
  saveSession({
    id: ss.sessionId,
    streamIndex: ss.streamIndex,
    label,
    cwd: WORKSPACE,
    ts: Date.now(),
  });
}

function handleEvent(e) {
  switch (e?.type) {
    case "message.appended":
      appendAssistantDelta(e.data?.messageSoFar ?? e.data?.messageDelta ?? "");
      break;
    case "message.completed":
      closeAssistant();
      break;
    case "reasoning.appended":
    case "reasoning.completed":
      setStatus(sty.dim("…thinking…"));
      break;
    case "step.started":
      setStatus(sty.dim(`model ${e.data?.modelId ?? ""}`.trim()));
      break;
    case "action.partial":
    case "action.result":
      appendTool(e.data?.result?.toolName ?? "tool");
      break;
    case "turn.started":
      busy = true;
      setStatus(color("warning", "…working"));
      break;
    case "turn.completed":
      closeAssistant();
      appendChat("✓ done", "green");
      busy = false;
      break;
    case "turn.failed":
      appendChat(`✗ turn failed [${e.data?.code ?? "?"}]: ${e.data?.message ?? "unknown error"}`, "red");
      busy = false;
      break;
    case "turn.cancelled":
      appendChat("⏹ cancelled", "yellow");
      busy = false;
      break;
    case "compaction.requested":
      appendChat("… compacting context", "magenta");
      busy = true;
      break;
    case "compaction.completed":
      appendChat("✓ context compacted", "magenta");
      busy = false;
      break;
    case "input.requested": {
      const reqs = e.data?.requests ?? [];
      pendingRequests = reqs;
      awaitingInput = reqs.length > 0;
      appendChat(`❓ ${reqs[0]?.prompt ?? "the agent is asking something"} — type your answer`, "cyan");
      break;
    }
    case "session.waiting":
      busy = false;
      setStatus(sty.dim("idle"));
      break;
    case "session.completed":
      appendChat("— session ended (use /new or /resume)", "gray");
      busy = false;
      break;
    case "session.failed": {
      const msg = `${e.data?.code ?? "?"}: ${e.data?.message ?? "session failed"}`;
      appendChat(
        `✗ session ended in failure [${msg}]. The next message starts a fresh session.`,
        "red",
      );
      removeSession(e.data?.sessionId);
      session = null; // recover: next prompt auto-creates a new session
      busy = false;
      break;
    }
    default:
      break;
  }
}

async function consume(response) {
  try {
    for await (const e of response) {
      handleEvent(e);
    }
  } catch (err) {
    appendChat(`✗ stream error: ${err?.message ?? err}`, "red");
  } finally {
    busy = false;
    awaitingInput = false;
    pendingRequests = [];
    if (session) persist(session.state);
    setStatus(sty.dim("idle"));
  }
}

async function sendTurn(text) {
  firstUserMessage = firstUserMessage ?? text;
  appendUser(text);
  input.setValue("");
  setStatus(color("warning", "…sending"));
  try {
    let response;
    if (session) {
      response = await session.send(text);
    } else {
      const created = await client.sessions.create({ message: text });
      session = created.session;
      response = created.response;
    }
    busy = true;
    await consume(response);
  } catch (err) {
    appendChat(`✗ send failed: ${err?.message ?? err}`, "red");
    busy = false;
    setStatus(sty.dim("idle"));
  }
}

async function answerPendingInput(text) {
  appendUser(text);
  input.setValue("");
  setStatus(color("warning", "…answering"));
  try {
    const reqs = pendingRequests;
    pendingRequests = [];
    awaitingInput = false;
    const response = reqs.length > 0
      ? await session.respond(reqs.map((r) => ({ requestId: r.requestId, value: text })))
      : await session.send(text);
    busy = true;
    await consume(response);
  } catch (err) {
    appendChat(`✗ answer failed: ${err?.message ?? err}`, "red");
    busy = false;
    setStatus(sty.dim("idle"));
  }
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
function cmdHelp() {
  for (const l of [
    "/new          start a brand-new session",
    "/resume <id>  resume a previous session (number from /sessions, id prefix, or label)",
    "/sessions     list saved sessions",
    "/compact      compact this session's context",
    "/clear        clear this session's history (keeps identity)",
    "/cancel       stop the current turn",
    "/quit         exit (or Ctrl+D; Ctrl+C cancels a running turn)",
  ]) {
    appendChat(l, "gray");
  }
}

function cmdSessions() {
  const list = loadSessions();
  if (list.length === 0) {
    appendChat("(no saved sessions yet)", "gray");
    return;
  }
  list.forEach((s, i) => {
    const date = new Date(s.ts ?? Date.now()).toISOString().slice(0, 16).replace("T", " ");
    appendChat(`${String(i + 1).padStart(2)} ${s.id.slice(0, 12)} · ${date} · ${s.label ?? ""}`, "dim");
  });
  appendChat("use /resume <number|id-prefix> to reopen one", "gray");
}

async function cmdResume(arg) {
  const list = loadSessions();
  if (list.length === 0) {
    appendChat("(no saved sessions to resume)", "gray");
    return;
  }
  let target = null;
  if (arg && /^\d+$/.test(arg)) {
    target = list[parseInt(arg, 10) - 1];
  } else if (arg) {
    target =
      list.find((s) => s.id.startsWith(arg)) ??
      list.find((s) => (s.label ?? "").toLowerCase().includes(arg.toLowerCase()));
  } else {
    target = list[0];
  }
  if (!target) {
    appendChat(`no session matching "${arg ?? ""}" — use /sessions`, "red");
    return;
  }
  try {
    session = client.sessions.attach(target.id, { streamIndex: target.streamIndex ?? 0 });
    firstUserMessage = target.label ?? null;
    appendChat(`↩ resuming ${target.id} · ${target.label ?? ""}`, "cyan");
    setStatus("…loading history");
    const snap = await session.snapshot();
    for (const e of snap.events) handleEvent(e);
    session = client.sessions.attach(target.id, { streamIndex: snap.session.streamIndex });
    busy = false;
    setStatus(sty.dim("idle — resumed"));
  } catch (err) {
    appendChat(`✗ resume failed: ${err?.message ?? err}`, "red");
    session = null;
  }
}

async function waitForBoundary() {
  for await (const e of session.stream({ follow: true })) {
    handleEvent(e);
    if (e.type === "session.waiting" || e.type === "session.completed" || e.type === "session.failed") return;
  }
}

async function cmdCompact() {
  if (!session) {
    appendChat("(no active session to compact)", "gray");
    return;
  }
  appendChat("… compacting", "magenta");
  try {
    const res = await session.compact();
    if (res.status !== "accepted") {
      appendChat("(compaction not accepted)", "gray");
      return;
    }
    await waitForBoundary();
  } catch (err) {
    appendChat(`✗ compact failed: ${err?.message ?? err}`, "red");
  } finally {
    busy = false;
  }
}

async function cmdClear() {
  if (!session) {
    appendChat("(no active session to clear)", "gray");
    return;
  }
  appendChat("… clearing history", "cyan");
  try {
    const res = await session.clear();
    if (res.status === "no_active_session") {
      appendChat("(no active session)", "gray");
      return;
    }
    await waitForBoundary();
  } catch (err) {
    appendChat(`✗ clear failed: ${err?.message ?? err}`, "red");
  } finally {
    busy = false;
  }
}

function cmdNew() {
  if (session) {
    session.reset({ reason: "new session requested" }).catch(() => {});
  }
  session = null;
  firstUserMessage = null;
  awaitingInput = false;
  pendingRequests = [];
  for (const kid of [...chatContainer.children]) chatContainer.removeChild(kid);
  liveAssistant = null;
  appendChat("— new session — start typing (or /resume)", "green");
}

async function runCommand(raw) {
  const [name, ...rest] = raw.slice(1).trim().split(/\s+/);
  const arg = rest.join(" ");
  switch (name) {
    case "help":
      cmdHelp();
      break;
    case "sessions":
      cmdSessions();
      break;
    case "resume":
      await cmdResume(arg);
      break;
    case "compact":
      await cmdCompact();
      break;
    case "clear":
      await cmdClear();
      break;
    case "new":
      cmdNew();
      break;
    case "cancel":
      if (busy) {
        appendChat("… cancelling", "yellow");
        session?.cancel().catch(() => {});
      } else {
        appendChat("(nothing to cancel)", "gray");
      }
      break;
    case "quit":
    case "exit":
      await quit();
      break;
    default:
      appendChat(`unknown command /${name} — try /help`, "red");
  }
}

async function quit() {
  try {
    tui?.stop();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let footerModel = "";

async function main() {
  if (!SERVER_URL) {
    console.error("eve-coder TUI: EVE_CODER_SERVER_URL is required.");
    process.exit(1);
  }
  client = new Client({ host: SERVER_URL });

  try {
    await client.health();
    const info = await client.info().catch(() => null);
    footerModel = info?.agent?.model?.id ?? "";
  } catch (err) {
    console.error(`eve-coder TUI: cannot reach eve server at ${SERVER_URL}: ${err?.message ?? err}`);
    process.exit(1);
  }

  const terminal = new ProcessTerminal();
  tui = new TuiMainScreen(terminal, true, join(stateDir(), "logs"));

  chatContainer = new Container();
  input = new Input();
  input.onSubmit = async (value) => {
    const text = value.trim();
    if (text.length === 0) return;
    input.setValue("");
    if (awaitingInput) {
      await answerPendingInput(text);
      return;
    }
    if (text.startsWith("/")) {
      await runCommand(text);
      return;
    }
    await sendTurn(text);
  };
  input.onEscape = () => input.setValue("");

  tui.addChild(chatContainer);
  tui.addChild(input);
  statusLine = new Text("", 0, 0);
  tui.addChild(statusLine);

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) {
      if (busy) {
        appendChat("… cancelling", "yellow");
        session?.cancel().catch(() => {});
      } else {
        quit();
      }
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+d")) {
      quit();
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+l")) {
      terminal.clearScreen();
      return { consume: true };
    }
    if (matchesKey(data, "tab")) {
      const v = input.getValue();
      if (v.startsWith("/")) {
        const prefix = v.toLowerCase();
        const cands = COMMANDS.filter((c) => c.startsWith(prefix));
        if (cands.length === 1) {
          input.setValue(`${cands[0]} `);
          return { consume: true };
        }
        if (cands.length > 1) {
          setStatus(color("muted", `completions: ${cands.join("  ")}`));
          return { consume: true };
        }
      }
    }
    return undefined;
  });

  tui.setFocus(input);
  tui.start();

  setStatus(
    `${color("accent", sty.bold("eve-coder"))} ${color("dim", `· ${footerModel || "?"} · ${WORKSPACE || "no workspace"}`)} ${color("muted", "/help")}`,
  );
  appendChat(`eve-coder — local coding agent (${footerModel || "model"}). Type /help for commands.`, "green");
  tui.requestRender();

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => quit());
  }
}

main().catch((err) => {
  console.error("eve-coder TUI crashed:", err);
  process.exit(1);
});
