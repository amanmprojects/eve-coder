/**
 * Per-tool renderers for the transcript's tool blocks.
 *
 * Each renderer turns an `actions.requested` input and an `action.result`
 * output into display text. A renderer may implement any subset of:
 *
 *   title(input)           → summary shown after the tool name on the header
 *   status(output, input)   → short right-hand suffix on the header (exit code…)
 *   detail(input)           → lines shown while running / when there is no output
 *   output(output, input)   → lines shown once the tool returns
 *
 * Anything not covered falls back to pretty-printed JSON, which is what pi does
 * for tools its shell doesn't know about. `isError` styling is handled by the
 * block itself, not here.
 */
import { color, sty } from "./theme.mjs";
import { formatBytes, formatTokens, oneLine } from "./format.mjs";

const MAX_JSON_CHARS = 20000;

function jsonish(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > MAX_JSON_CHARS ? `${text.slice(0, MAX_JSON_CHARS)}\n… (truncated)` : text;
  } catch {
    return String(value);
  }
}

/** `12\tcontent` (as produced by numberLines) → dim gutter + content. */
function paintNumberedLines(text) {
  return String(text)
    .split("\n")
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab <= 0) return line;
      const num = line.slice(0, tab);
      if (!/^\d+$/.test(num)) return line;
      return `${color("dim", num.padStart(5))} ${line.slice(tab + 1)}`;
    })
    .join("\n");
}

const renderers = {
  bash: {
    // The `$ ` prefix is the header, so the title is the bare command.
    title: (input) => oneLine(input?.command, 400),
    status: (out) => {
      if (!out || typeof out !== "object") return null;
      if (out.timedOut) return color("error", "timed out");
      if (out.aborted) return color("warning", "cancelled");
      if (out.exitCode) return color("error", `exit ${out.exitCode}`);
      return null;
    },
    output: (out) => {
      if (!out || typeof out !== "object") return jsonish(out);
      const parts = [];
      if (out.stdout) parts.push(String(out.stdout).replace(/\n+$/, ""));
      if (out.stderr) parts.push(color("error", String(out.stderr).replace(/\n+$/, "")));
      if (parts.length === 0) return color("dim", "(no output)");
      return parts.join("\n");
    },
  },

  read_file: {
    title: (input) => {
      const range = input?.offset ? ` :${input.offset}${input.limit ? `+${input.limit}` : ""}` : "";
      return `${input?.path ?? ""}${color("dim", range)}`;
    },
    status: (out) => {
      if (!out || typeof out !== "object") return null;
      if (out.binary) return color("warning", "binary");
      // `lines` is the slice actually read; fall back to counting the content so
      // a partial/streamed payload still reports something true.
      const shown = out.lines ?? (out.content ? String(out.content).split("\n").length : 0);
      const of = out.totalLines ? `/${out.totalLines}` : "";
      const trunc = out.truncated ? color("warning", " truncated") : "";
      return `${color("dim", `${shown}${of} lines`)}${trunc}`;
    },
    output: (out) => {
      if (!out || typeof out !== "object") return jsonish(out);
      if (out.binary) return color("dim", "(binary file, not shown)");
      return paintNumberedLines(out.content ?? "");
    },
  },

  write_file: {
    title: (input) => input?.path ?? "",
    status: (out) => {
      if (!out || typeof out !== "object") return null;
      const verb = out.created ? color("success", "created") : out.overwritten ? color("warning", "overwritten") : "";
      const size = out.wroteBytes != null ? color("dim", formatBytes(out.wroteBytes)) : "";
      return [verb, size].filter(Boolean).join(" ");
    },
    detail: (input) => input?.content ?? null,
    output: (_out, input) => input?.content ?? null,
  },

  edit_file: {
    title: (input) => input?.path ?? "",
    status: (out) => {
      if (!out || typeof out !== "object") return null;
      const edits = out.editsApplied != null ? `${out.editsApplied} edit${out.editsApplied === 1 ? "" : "s"}` : "";
      const occ = out.occurrences != null && out.occurrences !== out.editsApplied
        ? `${out.occurrences} occurrences`
        : "";
      return color("dim", [edits, occ].filter(Boolean).join(" · "));
    },
    // A real unified diff needs the pre-edit file; the edit list is what we
    // have, so show it as a +/- pair per edit, which reads like a diff hunk.
    detail: (input) => {
      const edits = Array.isArray(input?.edits) ? input.edits : [];
      if (edits.length === 0) return null;
      return edits
        .map((edit) => {
          const removed = String(edit?.oldText ?? "")
            .split("\n")
            .map((l) => color("toolDiffRemoved", `- ${l}`))
            .join("\n");
          const added = String(edit?.newText ?? "")
            .split("\n")
            .map((l) => color("toolDiffAdded", `+ ${l}`))
            .join("\n");
          return [removed, added].filter(Boolean).join("\n");
        })
        .join(`\n${color("toolDiffContext", "…")}\n`);
    },
    output: (_out, input) => renderers.edit_file.detail(input),
  },

  ls: {
    title: (input) => input?.path ?? ".",
    status: (out) => {
      if (!out || typeof out !== "object") return null;
      if (out.isDirectory === false) return color("dim", out.kind ?? "file");
      const trunc = out.truncated ? color("warning", " truncated") : "";
      return `${color("dim", `${out.count ?? 0} entries`)}${trunc}`;
    },
    output: (out) => {
      if (!out || typeof out !== "object") return jsonish(out);
      if (out.isDirectory === false) return color("dim", out.message ?? "not a directory");
      const entries = Array.isArray(out.entries) ? out.entries : [];
      if (entries.length === 0) return color("dim", "(empty)");
      return entries
        .map((e) => {
          if (typeof e === "string") return e;
          const isDir = e?.kind === "directory" || e?.isDirectory;
          const name = isDir ? color("blue", `${e?.name ?? ""}/`) : (e?.name ?? "");
          const meta = isDir
            ? e?.count != null
              ? color("dim", ` (${e.count})`)
              : ""
            : e?.size != null
              ? color("dim", ` ${typeof e.size === "number" ? formatBytes(e.size) : e.size}`)
              : "";
          return `${name}${meta}`;
        })
        .join("\n");
    },
  },

  glob: {
    title: (input) => {
      const base = input?.cwd ? color("dim", ` in ${input.cwd}`) : "";
      return `${input?.pattern ?? ""}${base}`;
    },
    status: (out) =>
      out && typeof out === "object" ? color("dim", `${out.matches ?? 0} matches`) : null,
    output: (out) => {
      if (!out || typeof out !== "object") return jsonish(out);
      const files = Array.isArray(out.files) ? out.files : [];
      return files.length === 0 ? color("dim", "(no matches)") : files.join("\n");
    },
  },

  grep: {
    title: (input) => {
      const where = input?.globPattern ? color("dim", ` in ${input.globPattern}`) : "";
      const ci = input?.caseSensitive ? "" : color("dim", " -i");
      return `${sty.bold(input?.pattern ?? "")}${where}${ci}`;
    },
    status: (out) => {
      if (!out || typeof out !== "object") return null;
      const capped = out.maxResultsReached ? color("warning", " capped") : "";
      return `${color("dim", `${out.matches ?? 0} in ${out.filesExamined ?? 0} files`)}${capped}`;
    },
    output: (out) => {
      if (!out || typeof out !== "object") return jsonish(out);
      const hits = Array.isArray(out.hits) ? out.hits : [];
      if (hits.length === 0) return color("dim", "(no matches)");
      return hits
        .map((hit) => {
          const head = color("mdLink", hit?.file ?? "");
          const lines = Array.isArray(hit?.lines) ? paintNumberedLines(hit.lines.join("\n")) : "";
          return `${head}\n${lines}`;
        })
        .join("\n");
    },
  },

  // Framework tools ---------------------------------------------------------

  ask_question: {
    title: (input) => oneLine(input?.question ?? input?.prompt, 300),
  },

  load_skill: {
    title: (input) => oneLine(input?.name ?? input?.skill, 120),
  },
};

/** Display name for a tool block header. */
export function toolLabel(name) {
  return name === "bash" ? "$" : name;
}

/**
 * Whether a collapsed block should keep the *end* of its output.
 *
 * For a command you want the last lines (the result); for a file read or a
 * listing you want the first lines.
 */
const TAIL_PREVIEW = new Set(["bash"]);
export function prefersTail(name) {
  return TAIL_PREVIEW.has(name);
}

/**
 * Render the header summary for a tool call.
 * Falls back to a compact inline JSON of the input.
 */
export function renderTitle(name, input) {
  const r = renderers[name];
  if (r?.title) {
    try {
      return r.title(input) ?? "";
    } catch {
      /* fall through to the generic form */
    }
  }
  if (input == null) return "";
  if (typeof input === "string") return oneLine(input, 300);
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  return color("dim", oneLine(keys.map((k) => `${k}=${oneLine(input[k], 60)}`).join(" "), 300));
}

/** Render the header's right-hand status suffix, if the tool has one. */
export function renderStatus(name, output, input) {
  const r = renderers[name];
  if (!r?.status) return null;
  try {
    return r.status(output, input);
  } catch {
    return null;
  }
}

/** Render the body shown while the tool is still running. */
export function renderDetail(name, input) {
  const r = renderers[name];
  if (!r?.detail) return null;
  try {
    return r.detail(input);
  } catch {
    return null;
  }
}

/**
 * Render the body for a finished tool call.
 *
 * `isError` results carry a message rather than the tool's normal shape, so
 * they are shown verbatim instead of going through the tool renderer.
 */
export function renderOutput(name, output, input, isError) {
  if (isError) return color("error", jsonish(output) || "(failed)");
  const r = renderers[name];
  if (r?.output) {
    try {
      const rendered = r.output(output, input);
      if (rendered != null) return rendered;
    } catch {
      /* fall through to JSON */
    }
  }
  if (r && !r.output && !r.detail) return null; // header-only tool
  return jsonish(output);
}

/** Summary line for a delegated subagent result. */
export function renderSubagentStatus(result) {
  const usage = result?.usage;
  if (!usage) return null;
  const parts = [];
  if (usage.inputTokens) parts.push(`↑${formatTokens(usage.inputTokens)}`);
  if (usage.outputTokens) parts.push(`↓${formatTokens(usage.outputTokens)}`);
  return parts.length ? color("dim", parts.join(" ")) : null;
}
