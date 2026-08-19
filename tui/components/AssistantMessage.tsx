import type { EveMessage } from "eve/react";
import { theme } from "../theme";
import { AssistantMessageFrame, AssistantReasoningFrame } from "./MessageFrames";
import { ToolBlock } from "./tools/ToolBlock";
import { usePrefs } from "../hooks/usePrefs";

export function AssistantMessage({ message }: { message: EveMessage }) {
  const { prefs } = usePrefs();

  return (
    <box flexDirection="column" gap={1} flexShrink={0} minWidth={0} width="100%">
      {message.parts.map((part, index) => {
        const key = `${part.type}-${index}`;
        switch (part.type) {
          case "text":
            return (
              <AssistantMessageFrame key={key}>
                <text fg={theme.text}>{part.text}</text>
              </AssistantMessageFrame>
            );
          case "reasoning":
            if (!prefs.showReasoning) {
              return (
                <AssistantReasoningFrame key={key}>
                  <text fg={theme.dim}>
                    {part.state === "streaming" ? "✻ thinking…" : "✻ reasoning hidden (/reasoning to show)"}
                  </text>
                </AssistantReasoningFrame>
              );
            }
            return (
              <AssistantReasoningFrame key={key}>
                <text fg={theme.muted}>{part.text}</text>
              </AssistantReasoningFrame>
            );
          case "dynamic-tool":
            return <ToolBlock key={key} part={part} />;
          case "step-start":
            return null;
          case "authorization":
            return (
              <AssistantMessageFrame key={key}>
                <text fg={theme.warning}>
                  {part.state === "completed"
                    ? `${part.displayName} ${part.outcome}`
                    : `Authorization required: ${part.displayName}`}
                </text>
              </AssistantMessageFrame>
            );
          case "file":
            return null;
          default:
            return null;
        }
      })}
    </box>
  );
}
