import type { EveMessage } from "eve/react";
import { useEveAgent, type UseEveAgentHelpers, type EveMessageData } from "eve/react";
import type { ScrollAcceleration } from "@opentui/core";
import { theme } from "../theme";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { AssistantMessageFrame } from "./MessageFrames";
import { useModelName } from "../hooks/useModelName";

type ScrollableMessageListProps = {
  messages: readonly EveMessage[];
  status: UseEveAgentHelpers<EveMessageData>["status"];
};

const MESSAGE_LIST_SCROLL_MULTIPLIER = 5;

const messageListScrollAcceleration: ScrollAcceleration = {
  tick() {
    return MESSAGE_LIST_SCROLL_MULTIPLIER;
  },
  reset() {},
};

export function ScrollableMessageList({ messages, status }: ScrollableMessageListProps) {
  const modelName = useModelName();
  const lastId = messages[messages.length - 1]?.id;
  const liveTurn = status === "streaming" || status === "submitted";

  return (
    <scrollbox
      flexGrow={1}
      minHeight={0}
      stickyScroll
      stickyStart="bottom"
      scrollAcceleration={messageListScrollAcceleration}
      rootOptions={{ backgroundColor: theme.bg }}
      paddingRight={2}
    >
      <box flexDirection="column" paddingX={0} paddingY={1} gap={1} minWidth={0} width="100%">
        {messages.map((m) => {
          const isStreaming = liveTurn && m.id === lastId && m.role === "assistant";
          if (m.role === "user") {
            return <UserMessage key={m.id} message={m} />;
          }
          if (m.role === "assistant") {
            return <AssistantMessage key={m.id} message={m} />;
          }
          return null;
        })}

        {liveTurn ? (
          <AssistantMessageFrame>
            <text fg={theme.text}>
              <span fg={theme.accent}>▣</span>
              {` thinking · ${modelName}`}
            </text>
          </AssistantMessageFrame>
        ) : null}
      </box>
    </scrollbox>
  );
}
