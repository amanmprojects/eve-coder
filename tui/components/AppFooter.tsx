import { TextAttributes } from "@opentui/core";
import { theme, effortColor } from "../theme";
import { shortenPath } from "../utils/format";

interface AppFooterProps {
  statsLeft: string;
  model: string;
  effort: string;
  workspace: string;
  sessionId: string | null;
}

const HINTS: [string, string][] = [
  ["esc", "interrupt"],
  ["ctrl+c", "cancel"],
  ["ctrl+d", "exit"],
  ["/", "commands"],
  ["ctrl+o", "expand"],
  ["ctrl+r", "reasoning"],
];

export function AppFooter({ statsLeft, model, effort, workspace, sessionId }: AppFooterProps) {
  const where = shortenPath(workspace) || "no workspace";
  const sid = sessionId ? sessionId.slice(0, 8) : "";
  const hints = HINTS.map(([k, v]) => `${k} ${v}`).join(" · ");

  const modelPart = (
    <>
      <span fg={theme.accent}>{model}</span>
      {effort && effort !== "provider-default" ? (
        <>
          {" · "}
          <span fg={effortColor(effort)}>{effort}</span>
        </>
      ) : null}
    </>
  );

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Line 1: stats (left) · key hints (right) */}
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text attributes={TextAttributes.DIM} fg={theme.dim}>
          {statsLeft}
        </text>
        <text attributes={TextAttributes.DIM} fg={theme.muted}>
          {hints}
        </text>
      </box>
      {/* Line 2: session id (left) · model · effort · cwd (right) */}
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text attributes={TextAttributes.DIM} fg={theme.subtle}>
          {sid}
        </text>
        <text fg={theme.dim}>
          {modelPart}
          <span fg={theme.subtle}>{" · "}</span>
          <span fg={theme.dim}>{where}</span>
        </text>
      </box>
    </box>
  );
}
