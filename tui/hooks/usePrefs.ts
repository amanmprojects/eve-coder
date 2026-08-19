import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { useState, useCallback } from "react";

export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const dir = join(base, "eve-coder");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return dir;
}

const PREFS_FILE = join(stateDir(), "prefs.json");

const DEFAULTS = {
  showReasoning: true as boolean,
  expandTools: false as boolean,
};

export type Prefs = { showReasoning: boolean; expandTools: boolean };

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(PREFS_FILE, "utf8"));
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    return {
      showReasoning: typeof raw.showReasoning === "boolean" ? raw.showReasoning : DEFAULTS.showReasoning,
      expandTools: typeof raw.expandTools === "boolean" ? raw.expandTools : DEFAULTS.expandTools,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    writeFileSync(PREFS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    /* best effort */
  }
  return next;
}

/** React hook for persisted prefs. */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = savePrefs({ ...prev, ...patch });
      return next;
    });
  }, []);

  return { prefs, update };
}
