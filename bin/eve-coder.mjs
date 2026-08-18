#!/usr/bin/env node
/**
 * eve-coder — run the local coding agent from ANY directory (prebuilt).
 *
 * The npm package ships a prebuilt eve server under `agent/../.output`
 * (produced by `eve build`). This launcher:
 *   1. captures the directory you ran it from (that becomes the workspace),
 *   2. loads any unset env from ~/.config/eve-coder/env or ~/.eve-coder.env,
 *   3. spawns the prebuilt nitro server directly on 127.0.0.1 at a random
 *      free port with LOCAL_CODER_ROOT set to your launch directory,
 *   4. opens the interactive TUI connected to that server, and
 *   5. shuts the server down when the TUI exits.
 *
 * The server is spawned directly (`node .output/server/index.mjs`) rather
 * than through `eve start`: `eve start` prewarms sandboxes by reloading the
 * agent modules from the build machine's absolute source paths, which do not
 * exist on the machine the package is installed on.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 1. The workspace = the directory the user launched from (LC_ROOT overrides).
const workspaceRoot = process.env.LC_ROOT ?? process.cwd();
const BUILT_OUTPUT = join(APP_ROOT, ".output");
const SERVER_ENTRY = join(BUILT_OUTPUT, "server", "index.mjs");
const URL_RE = /http:\/\/127\.0\.0\.1:\d+/;

// 2. Optional user config file (~/.config/eve-coder/env or ~/.eve-coder.env) —
//    a place to keep AI_GATEWAY_API_KEY without editing your shell profile.
//    Keys already in the environment win (eve also prefers process.env).
function loadUserEnv() {
  const home = homedir();
  const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const candidates = [join(xdg, "eve-coder", "env"), join(home, ".eve-coder.env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (key && process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
    }
  }
}

// Server logs go to XDG_STATE_HOME/eve-coder/server.log so they never garble
// the TUI. If the server fails to boot we print the tail.
function serverLogPath() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const dir = join(base, "eve-coder");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return join(dir, "server.log");
}
function appendLog(file, text) {
  try {
    appendFileSync(file, text);
  } catch {
    /* best effort */
  }
}

loadUserEnv();
if (!existsSync(SERVER_ENTRY)) {
  console.error(
    `eve-coder: no prebuilt server at ${SERVER_ENTRY}. ` +
      "Reinstall a built version: npm i -g eve-coder (or run `npm run build` in the source repo).",
  );
  process.exit(1);
}

// The prebuilt server keeps its local workflow store in `cwd/.eve/.workflow-data`,
// so it must run from a directory the current user can write to. Use the same
// state directory as the server log rather than the (root-owned) package dir.
const logFile = serverLogPath();
const serverCwd = dirname(logFile);
const serverEnv = {
  ...process.env,
  LOCAL_CODER_ROOT: workspaceRoot,
  HOST: "127.0.0.1",
  NITRO_HOST: "127.0.0.1",
  PORT: "0",
  NITRO_PORT: "0",
};
const server = spawn(process.execPath, [SERVER_ENTRY], {
  cwd: serverCwd,
  env: serverEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

let url = null;
let serverTail = "";
let tui = null;
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  process.exit(code ?? 0);
}

function shutdownServer() {
  server.kill("SIGTERM");
  // Force-kill after a short grace period.
  setTimeout(() => server.kill("SIGKILL"), 3000).unref();
}

function startTui() {
  // Our pi-tui TUI talks to the prebuilt server over eve/client. It receives
  // the server URL and workspace via the environment.
  const tuiScript = join(APP_ROOT, "tui", "client.mjs");
  tui = spawn(process.execPath, [tuiScript], {
    cwd: APP_ROOT,
    env: { ...serverEnv, EVE_CODER_SERVER_URL: url },
    stdio: "inherit",
  });
  tui.on("exit", (code) => {
    shutdownServer();
    finish(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      tui?.kill(sig);
      shutdownServer();
      setTimeout(() => finish(sig === "SIGINT" ? 130 : 143), 500).unref();
    });
  }
}

server.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  appendLog(logFile, text);
  if (!url) {
    serverTail += text;
    if (serverTail.length > 20_000) serverTail = serverTail.slice(-20_000);
    const m = serverTail.match(URL_RE);
    if (m) {
      url = m[0];
      startTui();
    }
  }
});
server.stderr.on("data", (chunk) => appendLog(logFile, chunk));

server.on("error", (err) => {
  console.error(`eve-coder: failed to start the server: ${err.message}`);
  process.exit(1);
});
server.on("exit", (code) => {
  if (!url) {
    const logExists = existsSync(logFile);
    console.error(`eve-coder: server exited before becoming ready (code ${code ?? "?"}).`);
    if (logExists) {
      console.error("--- server log tail ---");
      try {
        const lines = readFileSync(logFile, "utf8").split("\n").slice(-25);
        console.error(lines.join("\n"));
      } catch {
        /* ignore */
      }
    }
    process.exit(code ?? 1);
  }
  // Server died while the TUI was attached → close the TUI too.
  tui?.kill("SIGTERM");
  finish(1);
});
