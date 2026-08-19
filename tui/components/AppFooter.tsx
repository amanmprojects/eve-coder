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
  const right = !effort || effort === "provider-default"
    ? model
    : `${model} • ${effort}`;

  const where = shortenPath(workspace) || "no workspace";
  const sid = sessionId ? ` ${sessionId.slice(0, 8)}` : "";

  const hints = HINTS.map(([k, v]) => `${k} ${v}`).join(" · ");

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Stats line */}
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text attributes={TextAttributes.DIM} fg={theme.dim}>
          {statsLeft}
        </text>
        <text fg={theme.text}>
          <span fg={theme.accent}>{model}</span>
          {effort && effort !== "provider-default" ? (
            <>
              {" · "}
              <span fg={effortColor(effort)}>{effort}</span>
            </>
          ) : null}
          {sid ? <span fg={theme.subtle}>{sid}</span> : null}
        </text>
      </box>
      {/* Hints + workspace line */}
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text attributes={TextAttributes.DIM} fg={theme.muted}>
          {hints}
        </text>
        <text attributes={TextAttributes.DIM} fg={theme.dim}>
          {where}
        </text>
      </box>
    </box>
  );
}
