import { spawn } from "node:child_process";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { DEFAULT_MAX_BYTES, sanitizeBinaryOutput } from "../lib/truncate.js";
import { displayPath, resolveToRoot, workspaceRoot } from "../lib/workspace.js";

const MAX_OUTPUT = DEFAULT_MAX_BYTES; // 50KB tail kept per stream (model-facing)
const COMBINED_TAIL = DEFAULT_MAX_BYTES * 2; // 100KB window kept to seed the full-output file
const SPILL_THRESHOLD = DEFAULT_MAX_BYTES; // start spilling to a file past this
const MAX_FILE_BYTES = 50 * 1024 * 1024; // hard cap so a runaway command can't fill disk

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  fullOutputPath?: string;
}

function keepTail(s: string, max: number): string {
  return s.length <= max ? s : s.slice(-max);
}

function runCommand(
  command: string,
  opts: { cwd: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let combined = ""; // interleaved stdout+stderr, used to seed the full-output file
    let truncated: "lines" | "bytes" | null = null;
    let stdoutCapped = false;
    let stderrCapped = false;
    let fullOutputPath: string | undefined;
    let fileHandle: FileHandle | undefined;
    let fileBytes = 0;
    let fileFull = false;

    // Serialize chunk processing so stdout/stderr data events can't race on
    // temp-file creation or interleave file writes out of order.
    let chain: Promise<void> = Promise.resolve();

    async function ensureFile() {
      if (fileHandle) return;
      const name = `bash-${Date.now()}-${randomBytes(6).toString("hex")}.log`;
      fullOutputPath = join(tmpdir(), name);
      fileHandle = await open(fullOutputPath, "w");
      // Seed with the recent combined output we still hold in memory.
      await fileHandle.writeFile(combined);
      fileBytes = Buffer.byteLength(combined, "utf8");
    }

    async function processChunk(chunk: Buffer, stream: "stdout" | "stderr") {
      const text = sanitizeBinaryOutput(chunk.toString("utf8"));
      if (stream === "stdout") {
        const next = stdout + text;
        if (next.length > MAX_OUTPUT) {
          stdout = next.slice(-MAX_OUTPUT);
          stdoutCapped = true;
        } else {
          stdout = next;
        }
      } else {
        const next = stderr + text;
        if (next.length > MAX_OUTPUT) {
          stderr = next.slice(-MAX_OUTPUT);
          stderrCapped = true;
        } else {
          stderr = next;
        }
      }
      combined = keepTail(combined + text, COMBINED_TAIL);
      if (!truncated && combined.length >= SPILL_THRESHOLD) truncated = "bytes";
      if (fileHandle && !fileFull) {
        const bytes = Buffer.byteLength(text, "utf8");
        if (fileBytes + bytes > MAX_FILE_BYTES) {
          fileFull = true;
        } else {
          try {
            await fileHandle.writeFile(text);
            fileBytes += bytes;
          } catch {
            /* best-effort log; in-memory tails still hold the recent output */
          }
        }
      } else if (truncated && !fileHandle) {
        await ensureFile().catch(() => undefined);
      }
    }

    function append(chunk: Buffer, stream: "stdout" | "stderr") {
      chain = chain.then(() => processChunk(chunk, stream));
    }

    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    let resolved = false;

    async function finish(exitCode: number, spawnError?: string) {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", handleAbort);
      // Drain any in-flight chunk processing before reading the tails.
      await chain.catch(() => undefined);
      if (fileHandle) await fileHandle.close().catch(() => undefined);

      const note = (s: string, capped: boolean): string => {
        if (!capped) return s;
        const where = fullOutputPath ? `; full output: ${fullOutputPath}` : "";
        return `${s}\n… [output truncated${where}]`;
      };

      resolvePromise({
        command,
        cwd: displayPath(opts.cwd),
        exitCode,
        timedOut,
        aborted: opts.signal?.aborted === true,
        stdout: note(stdout, stdoutCapped) + (spawnError ? `\n${spawnError}` : ""),
        stderr: note(stderr, stderrCapped),
        truncated: truncated !== null,
        truncatedBy: truncated,
        fullOutputPath,
      });
    }

    function handleAbort() {
      timedOut = false;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }

    const child = spawn("bash", ["-lc", command], {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout?.on("data", (c: Buffer) => append(c, "stdout"));
    child.stderr?.on("data", (c: Buffer) => append(c, "stderr"));
    child.on("error", (err) => void finish(1, `Failed to start command: ${err.message}`));
    child.on("close", (code) => void finish(code ?? 1));

    if (opts.signal?.aborted) handleAbort();
    else opts.signal?.addEventListener("abort", handleAbort);

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        truncated = truncated ?? "lines";
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, opts.timeoutMs);
      timer.unref();
    }
  });
}

export default defineTool({
  description: `Run a shell command on the local machine and capture its output.
Commands execute as the current user with full privileges — no sandbox isolation. cwd defaults to the
workspace root (${workspaceRoot}); set cwd to run elsewhere. Long-running commands should pass a
reasonable timeoutMs. Returns stdout, stderr, and the exit code. Each stream is capped at a ~${Math.round(
    MAX_OUTPUT / 1024,
  )}KB tail; when output exceeds that, the full interleaved output is spilled to a temp file whose path is
returned in fullOutputPath (read it with bash if you need more). Non-printable control characters are stripped.`,
  inputSchema: z.object({
    command: z.string().min(1).describe("The shell command to run (bash -lc)."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .describe("Kill the command after this many milliseconds (default 120000)."),
    cwd: z
      .string()
      .optional()
      .describe("Working directory for the command, relative to the workspace root or absolute."),
  }),
  async execute({ command, timeoutMs = 120_000, cwd }, ctx) {
    return runCommand(command, {
      cwd: cwd ? resolveToRoot(cwd) : workspaceRoot,
      timeoutMs,
      signal: ctx.abortSignal,
    });
  },
});
