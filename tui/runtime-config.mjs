/**
 * Persisted TUI preferences, plus the effort-level vocabulary shared with the
 * launcher.
 *
 * Model and reasoning effort are NOT stored here. They are static
 * `defineAgent` fields read from the environment when the server boots
 * (`eve-coder --model <id> --effort <level>`), and the server reports both back
 * over `/eve/v1/info` — so the TUI displays what the server actually resolved
 * rather than a local guess that could drift.
 *
 * What is stored here is only what the TUI itself owns: which parts of the
 * transcript to show.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Provider-agnostic reasoning levels eve forwards to the AI SDK call. */
export const EFFORT_LEVELS = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/** Friendly aliases so `--effort max` and `--effort med` do the obvious thing. */
const EFFORT_ALIASES = {
  max: "xhigh",
  maximum: "xhigh",
  xh: "xhigh",
  med: "medium",
  mid: "medium",
  default: "provider-default",
  off: "none",
  min: "minimal",
};

export const DEFAULT_MODEL = "zai/glm-5.2";
export const DEFAULT_EFFORT = "xhigh";

/** Normalize a user-typed effort level, or return null when it isn't one. */
export function normalizeEffort(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  const mapped = EFFORT_ALIASES[key] ?? key;
  return EFFORT_LEVELS.includes(mapped) ? mapped : null;
}

export function stateDir() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const dir = join(base, "eve-coder");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort — reads below tolerate a missing directory */
  }
  return dir;
}

export const PREFS_FILE = join(stateDir(), "prefs.json");

const DEFAULTS = {
  /** Render reasoning traces inline instead of collapsing them to a label. */
  showReasoning: true,
  /** Render tool blocks expanded (no preview truncation). */
  expandTools: false,
};

export function loadPrefs() {
  try {
    const raw = JSON.parse(readFileSync(PREFS_FILE, "utf8"));
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    return {
      showReasoning:
        typeof raw.showReasoning === "boolean" ? raw.showReasoning : DEFAULTS.showReasoning,
      expandTools: typeof raw.expandTools === "boolean" ? raw.expandTools : DEFAULTS.expandTools,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Merge `patch` into the stored preferences and return the result. */
export function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch };
  try {
    writeFileSync(PREFS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    /* best effort — an unwritable state dir shouldn't kill the session */
  }
  return next;
}
