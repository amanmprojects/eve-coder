/**
 * Serialize file mutations targeting the same canonical path.
 *
 * The model can emit multiple tool calls in one turn. Two edits/writes that
 * target the same file would otherwise race on read-modify-write and the
 * second would clobber the first's result. This module chains work per
 * real-path so mutations to one file happen strictly in arrival order.
 *
 * Ported in spirit from pi's `harness/tools/file-mutation-queue.ts`, adapted to
 * the local filesystem (no `ExecutionEnv` abstraction).
 */
import { realpath } from "node:fs/promises";

const queues = new Map<string, Promise<unknown>>();

async function keyFor(absPath: string): Promise<string> {
  try {
    return await realpath(absPath);
  } catch {
    // Path may not exist yet (a new file). Fall back to the resolved absolute
    // path so concurrent creates of the same path still serialize.
    return absPath;
  }
}

export async function withFileMutationQueue<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
  const key = await keyFor(absPath);
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => next);
  queues.set(key, chained);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (queues.get(key) === chained) queues.delete(key);
  }
}
