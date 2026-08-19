import { realpath } from "node:fs/promises";
import * as path from "node:path";

/**
 * Windows-style UNC paths (e.g. `\\server\share`).
 */
export function isUNCPath(filePath: string): boolean {
  if (filePath.startsWith("\\\\")) {
    return true;
  }
  // UNC can appear as //server/share on some APIs
  return /^\/\/[^/]+/.test(filePath);
}

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "clock$",
  "conin$",
  "conout$",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function isWindowsReservedPath(normalized: string): boolean {
  const withoutSlash = normalized.replaceAll("/", "\\");
  const segments = withoutSlash.split("\\").filter(Boolean);
  for (const segment of segments) {
    // Strip extension (.txt) and ADS suffix (:$DATA)
    let base = segment;
    const colonIdx = base.indexOf(":");
    if (colonIdx > 0) {
      base = base.slice(0, colonIdx);
    }
    const dotIdx = base.indexOf(".");
    if (dotIdx > 0) {
      base = base.slice(0, dotIdx);
    }
    if (WINDOWS_RESERVED.has(base.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Paths that would block, hang, or yield unbounded output when read or listed.
 * Follows symlinks via realpath before prefix checks so links into blocked trees are rejected.
 */
export async function isBlockedDevicePath(resolvedPath: string): Promise<boolean> {
  const normalized = path.normalize(resolvedPath);

  let resolved: string;
  try {
    resolved = await realpath(normalized);
  } catch {
    resolved = normalized;
  }

  if (process.platform === "win32") {
    const winPath = path.win32.normalize(resolved);
    const lower = winPath.toLowerCase();
    if (
      lower.startsWith("\\\\.\\") ||
      lower.startsWith("\\\\?\\") ||
      isWindowsReservedPath(winPath)
    ) {
      return true;
    }
    return false;
  }

  const posix = path.posix.normalize(resolved);
  const blockedRoots = ["/dev", "/proc", "/sys", "/run"] as const;
  for (const root of blockedRoots) {
    if (posix === root || posix.startsWith(`${root}/`)) {
      return true;
    }
  }
  return false;
}
