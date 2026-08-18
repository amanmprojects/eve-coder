/**
 * Local session catalog.
 *
 * eve owns the durable sessions; this file only remembers which ones this
 * machine has seen so `/sessions` and `/resume` work across TUI restarts. The
 * `streamIndex` is stored alongside the id because attaching without it would
 * replay the whole stream from the beginning.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./runtime-config.mjs";

const MAX_STORED_SESSIONS = 50;
const SESSIONS_FILE = join(stateDir(), "sessions.json");

export function loadSessions() {
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    writeFileSync(SESSIONS_FILE, `${JSON.stringify(list.slice(0, MAX_STORED_SESSIONS), null, 2)}\n`);
  } catch {
    /* best effort */
  }
}

/** Upsert an entry, moving it to the front (most-recent-first ordering). */
export function saveSession(entry) {
  if (!entry?.id) return;
  const list = loadSessions().filter((s) => s.id !== entry.id);
  list.unshift(entry);
  write(list);
}

export function removeSession(id) {
  if (!id) return;
  write(loadSessions().filter((s) => s.id !== id));
}

/**
 * Resolve a `/resume` argument to a catalog entry.
 * Accepts a 1-based list position, an id prefix, or a label substring.
 */
export function findSession(arg) {
  const list = loadSessions();
  if (list.length === 0) return null;
  if (!arg) return list[0];
  if (/^\d+$/.test(arg)) return list[Number.parseInt(arg, 10) - 1] ?? null;
  return (
    list.find((s) => s.id.startsWith(arg)) ??
    list.find((s) => (s.label ?? "").toLowerCase().includes(arg.toLowerCase())) ??
    null
  );
}

/** Trim a first user message down to a list label. */
export function labelFor(text, fallback) {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!line) return fallback;
  return line.length > 70 ? `${line.slice(0, 69)}…` : line;
}
