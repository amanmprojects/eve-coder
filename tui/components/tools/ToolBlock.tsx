import { theme } from "../../theme";
import { oneLine } from "../../utils/format";
import type { EveDynamicToolPart } from "eve/react";
import { AssistantToolFrame } from "../MessageFrames";
import { usePrefs } from "../../hooks/usePrefs";
import { formatDuration } from "../../utils/format";

/** Format the title/summary for a tool call based on its name and input. */
function formatTitle(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  switch (toolName) {
    case "bash":
      return oneLine(String(obj.command ?? ""), 400);
    case "read_file":
    case "readFile":
      return String(obj.path ?? obj.filePath ?? "");
    case "write_file":
    case "writeFile":
      return String(obj.path ?? obj.filePath ?? "");
    case "edit_file":
    case "editFile":
      return String(obj.path ?? obj.filePath ?? "");
    case "ls":
    case "listDir":
      return String(obj.path ?? obj.dirPath ?? ".");
    case "glob":
    case "globSearch":
      return String(obj.pattern ?? "");
    case "grep":
    case "grepSearch":
      return String(obj.pattern ?? "");
    default: {
      const keys = Object.keys(obj);
      if (keys.length === 0) return "";
      return oneLine(keys.map((k) => `${k}=${oneLine(String(obj[k]), 60)}`).join(" "), 300);
    }
  }
}

/** Format the status suffix for a completed tool call. */
function formatStatus(toolName: string, output: unknown, input: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const out = output as Record<string, unknown>;

  switch (toolName) {
    case "bash": {
      if (out.timedOut) return "timed out";
      if (out.aborted) return "cancelled";
      if (out.exitCode && out.exitCode !== 0) return `exit ${out.exitCode}`;
      return "ok";
    }
    case "read_file":
    case "readFile": {
      if (out.binary) return "binary";
      const shown = Number(out.lines ?? 0);
      const total = Number(out.totalLines ?? 0);
      return total ? `${shown}/${total} lines` : `${shown} lines`;
    }
    case "write_file":
    case "writeFile":
      return out.created ? "created" : out.overwritten ? "overwritten" : "written";
    case "edit_file":
    case "editFile": {
      const applied = Number(out.editsApplied ?? 0);
      return `${applied} edit${applied === 1 ? "" : "s"}`;
    }
    case "ls":
    case "listDir":
      return `${Number(out.count ?? 0)} entries`;
    case "glob":
    case "globSearch":
      return `${Number(out.matches ?? 0)} matches`;
    case "grep":
    case "grepSearch":
      return `${Number(out.matches ?? 0)} in ${Number(out.filesExamined ?? 0)} files`;
    default:
      return null;
  }
}

/** Format tool output body for display. */
function formatOutput(toolName: string, output: unknown, expanded: boolean): string | null {
  if (!output || typeof output !== "object") return null;
  const out = output as Record<string, unknown>;

  // Error results
  if (typeof out.error === "string") return out.error;

  switch (toolName) {
    case "bash": {
      const parts: string[] = [];
      if (out.stdout) parts.push(String(out.stdout).replace(/\n+$/, ""));
      if (out.stderr) parts.push(String(out.stderr).replace(/\n+$/, ""));
      if (parts.length === 0) return "(no output)";
      const text = parts.join("\n");
      if (!expanded) return text.split("\n").slice(0, 8).join("\n");
      return text;
    }
    case "read_file":
    case "readFile":
      return String(out.content ?? out.message ?? "");
    case "write_file":
    case "writeFile":
      return typeof out.path === "string" ? String(out.path) : null;
    case "edit_file":
    case "editFile":
      return typeof out.diff === "string" ? out.diff : null;
    default:
      return null;
  }
}

/** Display label for a tool. */
function toolLabel(name: string): string {
  return name === "bash" ? "$" : name;
}

export function ToolBlock({ part }: { part: EveDynamicToolPart }) {
  const { prefs } = usePrefs();
  const input = part.input;
  const toolName = part.toolName;

  switch (part.state) {
    case "input-streaming":
      return (
        <AssistantToolFrame border={false}>
          <text fg={theme.muted}>{toolLabel(toolName)} reading arguments…</text>
        </AssistantToolFrame>
      );

    case "input-available": {
      const title = formatTitle(toolName, input);
      return (
        <AssistantToolFrame border={["left"]}>
          <text fg={theme.muted}>
            <span fg={theme.accent}>{toolLabel(toolName)}</span>
            {title ? ` ${title}` : ""}
            {" — running…"}
          </text>
        </AssistantToolFrame>
      );
    }

    case "output-available": {
      const title = formatTitle(toolName, input);
      const status = formatStatus(toolName, part.output, input);
      const body = formatOutput(toolName, part.output, prefs.expandTools);

      return (
        <AssistantToolFrame border={["left"]}>
          <text fg={theme.muted}>
            <span fg={theme.accent}>{toolLabel(toolName)}</span>
            {title ? ` ${title}` : ""}
            {status ? ` — ${status}` : ""}
          </text>
          {body ? (
            <box marginTop={0}>
              <text fg={theme.dim}>{body}</text>
            </box>
          ) : null}
        </AssistantToolFrame>
      );
    }

    case "output-error":
      return (
        <AssistantToolFrame border={["left"]}>
          <text fg={theme.muted}>
            <span fg={theme.accent}>{toolLabel(toolName)}</span>
            {formatTitle(toolName, input) ? ` ${formatTitle(toolName, input)}` : ""}
            <span fg={theme.error}> — error: {part.errorText}</span>
          </text>
        </AssistantToolFrame>
      );

    case "approval-requested":
      return (
        <AssistantToolFrame border={false}>
          <text fg={theme.muted}>{toolLabel(toolName)} — approval requested</text>
        </AssistantToolFrame>
      );

    case "approval-responded":
      return (
        <AssistantToolFrame border={false}>
          <text fg={theme.muted}>{toolLabel(toolName)} — approval responded</text>
        </AssistantToolFrame>
      );

    default:
      return (
        <AssistantToolFrame border={false}>
          <text fg={theme.muted}>{toolLabel(toolName)} — unknown state</text>
        </AssistantToolFrame>
      );
  }
}
