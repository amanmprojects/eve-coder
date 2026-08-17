import { spawn } from "node:child_process";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { displayPath, resolveToRoot, workspaceRoot } from "../lib/workspace.js";

const MAX_OUTPUT = 256 * 1024; // chars captured per stream

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  opts: { cwd: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const outputs = { stdout: "", stderr: "", truncated: { stdout: false, stderr: false } };

    function append(chunk: Buffer, stream: "stdout" | "stderr") {
      const next = outputs[stream] + chunk.toString("utf8");
      if (next.length >= MAX_OUTPUT) {
        outputs[stream] = next.slice(0, MAX_OUTPUT);
        outputs.truncated[stream] = true;
      } else {
        outputs[stream] = next;
      }
    }

    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    let resolved = false;

    function finish(exitCode: number, spawnError?: string) {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", handleAbort);
      const result: CommandResult = {
        command,
        cwd: displayPath(opts.cwd),
        exitCode,
        timedOut,
        aborted: opts.signal?.aborted === true,
        stdout:
          outputs.stdout +
          (outputs.truncated.stdout ? "\n… [output truncated]" : "") +
          (spawnError ? `\n${spawnError}` : ""),
        stderr: outputs.stderr + (outputs.truncated.stderr ? "\n… [output truncated]" : ""),
      };
      resolvePromise(result);
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
    child.on("error", (err) => finish(1, `Failed to start command: ${err.message}`));
    child.on("close", (code) => finish(code ?? 1));

    if (opts.signal?.aborted) handleAbort();
    else opts.signal?.addEventListener("abort", handleAbort);

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
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
reasonable timeoutMs. Returns stdout, stderr, and the exit code.`,
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
