#!/usr/bin/env node
/**
 * eve-coder — run the local coding agent from ANY directory.
 *
 * Installed globally (`npm i -g eve-coder`), this launcher:
 *   1. captures the directory you ran it from (that becomes the workspace),
 *   2. loads any unset env from ~/.config/eve-coder/env or ~/.eve-coder.env,
 *   3. spawns this package's bundled `eve dev` with LOCAL_CODER_ROOT set to
 *      your launch directory and a fresh random port per session, and
 *   4. opens the interactive TUI in your terminal.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 1. The workspace = the directory the user launched from (LC_ROOT overrides).
const workspaceRoot = process.env.LC_ROOT ?? process.cwd();

// 2. Optional user config file (~/.config/eve-coder/env or ~/.eve-coder.env) —
//    a place to keep AI_GATEWAY_API_KEY without editing your shell profile.
//    Keys already in the environment win (eve dev also prefers process.env).
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
      if (key && process.env[key] === undefined) {
        process.env[key] = line.slice(eq + 1).trim();
      }
    }
  }
}

// 3. Locate the bundled eve CLI (a dependency of this package).
function resolveEveBin() {
  const bits = process.platform === "win32" ? ["eve.cmd"] : ["eve"];
  for (const bit of bits) {
    const candidate = join(APP_ROOT, "node_modules", ".bin", bit);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

loadUserEnv();
const eveBin = resolveEveBin();
if (!eveBin) {
  console.error(
    "eve-coder: could not find the bundled 'eve' CLI. Reinstall with: npm i -g eve-coder",
  );
  process.exit(1);
}

// eve dev resolves its dev-runtime source root by walking UP from the app root
// until it finds a `.git` or `pnpm-workspace.yaml` marker. When eve-coder is
// installed globally under the nvm git checkout (~/.nvm), that walk overshoots
// the package and picks $NVM_DIR as the source root, which breaks bundling.
// Planting a `.git` marker at the package root stops the walk here.
function ensureSourceRootMarker() {
  const marker = join(APP_ROOT, ".git");
  if (existsSync(marker)) return;
  try {
    mkdirSync(marker);
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    console.error(
      `eve-coder: warning — could not create ${marker} (${msg}); ` +
        `eve dev may fail to bundle if a parent directory is itself a git repo.`,
    );
  }
}
ensureSourceRootMarker();

const args = process.argv.slice(2);
// `--port 0` makes the OS pick a fresh free port per session, so two
// eve-coder instances in different directories never collide or reconnect
// to each other's server.
const child =
  process.platform === "win32"
    ? spawn(eveBin, ["dev", "--name", "eve-coder", "--port", "0", ...args], {
        cwd: APP_ROOT,
        env: { ...process.env, LOCAL_CODER_ROOT: workspaceRoot },
        stdio: "inherit",
        shell: true,
      })
    : spawn(eveBin, ["dev", "--name", "eve-coder", "--port", "0", ...args], {
        cwd: APP_ROOT,
        env: { ...process.env, LOCAL_CODER_ROOT: workspaceRoot },
        stdio: "inherit",
      });

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
