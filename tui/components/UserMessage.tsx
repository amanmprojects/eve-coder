import type { EveMessage } from "eve/react";
import { theme } from "../theme";
import { UserMessageFrame } from "./MessageFrames";

export function UserMessage({ message }: { message: EveMessage }) {
  return (
    <box flexDirection="column" gap={1} flexShrink={0}>
      {message.parts.map((part, index) => {
        const key = `${part.type}-${index}`;
        switch (part.type) {
          case "text":
            return (
              <UserMessageFrame key={key}>
                <text fg={theme.text}>{part.text}</text>
              </UserMessageFrame>
            );
          default:
            return null;
        }
      })}
    </box>
  );
}
