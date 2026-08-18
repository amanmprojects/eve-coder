/**
 * Detect optional external CLIs (rg, fd) once per process, so grep/glob can use
 * them when present and fall back to the pure-JS implementation otherwise.
 * Fully local: never downloads anything — presence is opportunistic.
 */
import { access, constants } from "node:fs/promises";
import { env } from "node:process";

const cache = new Map<string, string | null>();

function paths(): string[] {
  return (env.PATH ?? "").split(":").filter(Boolean);
}

async function resolveBin(name: string): Promise<string | null> {
  for (const dir of paths()) {
    const candidate = `${dir}/${name}`;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not executable here; try next
    }
  }
  return null;
}

/** Return the path to `name` if it is on PATH, else null. Result is cached. */
export async function findBin(name: string): Promise<string | null> {
  if (cache.has(name)) return cache.get(name) ?? null;
  const found = await resolveBin(name);
  cache.set(name, found);
  return found;
}
