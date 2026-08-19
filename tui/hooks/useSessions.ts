import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./usePrefs";

const MAX_STORED_SESSIONS = 50;
const SESSIONS_FILE = join(stateDir(), "sessions.json");

export interface SessionEntry {
  id: string;
  streamIndex: number;
  label: string;
  cwd: string;
  ts: number;
}

export function loadSessions(): SessionEntry[] {
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeSessions(list: SessionEntry[]): void {
  try {
    writeFileSync(SESSIONS_FILE, `${JSON.stringify(list.slice(0, MAX_STORED_SESSIONS), null, 2)}\n`);
  } catch {
    /* best effort */
  }
}

export function saveSession(entry: SessionEntry): void {
  if (!entry?.id) return;
  const list = loadSessions().filter((s) => s.id !== entry.id);
  list.unshift(entry);
  writeSessions(list);
}

export function removeSession(id: string): void {
  if (!id) return;
  writeSessions(loadSessions().filter((s) => s.id !== id));
}

export function findSession(arg?: string): SessionEntry | null {
  const list = loadSessions();
  if (list.length === 0) return null;
  if (!arg) return list[0]!;
  if (/^\d+$/.test(arg)) return list[Number.parseInt(arg, 10) - 1] ?? null;
  return (
    list.find((s) => s.id.startsWith(arg)) ??
    list.find((s) => (s.label ?? "").toLowerCase().includes(arg.toLowerCase())) ??
    null
  );
}

export function labelFor(text: string | null, fallback: string): string {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!line) return fallback;
  return line.length > 70 ? `${line.slice(0, 69)}…` : line;
}
