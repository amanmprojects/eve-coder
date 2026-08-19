import type { ReactNode } from "react";
import { theme } from "../theme";
import { MessageFrame } from "./MessageFrame";

type SharedFrameProps = {
  children: ReactNode;
  backgroundColor?: string;
  paddingY?: number;
};

/** Assistant markdown text — left rule, blends with background. */
export function AssistantMessageFrame({ children, ...rest }: SharedFrameProps) {
  return (
    <MessageFrame {...rest} border={["left"]} borderColor={theme.bg}>
      {children}
    </MessageFrame>
  );
}

/** Assistant reasoning — heavier left rule, same border color as body text. */
export function AssistantReasoningFrame({ children, ...rest }: SharedFrameProps) {
  return (
    <MessageFrame {...rest} border={["left"]} borderColor={theme.panel} borderStyle="heavy">
      {children}
    </MessageFrame>
  );
}

/** Tool invocations — left rule, strip-bar background. */
export function AssistantToolFrame({
  children,
  border,
  borderStyle,
  backgroundColor,
  paddingY,
}: {
  children: ReactNode;
  border?: true | false | import("@opentui/core").BorderSides[];
  borderStyle?: import("@opentui/core").BorderStyle;
  backgroundColor?: string;
  paddingY?: number;
}) {
  if (border === false) {
    return (
      <MessageFrame border={false} backgroundColor={backgroundColor} paddingY={paddingY}>
        {children}
      </MessageFrame>
    );
  }
  return (
    <MessageFrame
      border={border ?? (["left"] as import("@opentui/core").BorderSides[])}
      borderColor={theme.bg}
      borderStyle={borderStyle ?? "heavy"}
      backgroundColor={backgroundColor ?? theme.stripBar}
      paddingY={paddingY ?? 1}
    >
      {children}
    </MessageFrame>
  );
}

/** User bubble — accent strip for text. */
export function UserMessageFrame({
  children,
  backgroundColor,
  paddingY,
}: SharedFrameProps) {
  return (
    <MessageFrame
      border={["left"]}
      borderColor={theme.accent}
      backgroundColor={backgroundColor ?? theme.stripBar}
      paddingY={paddingY ?? 1}
      borderStyle="heavy"
    >
      {children}
    </MessageFrame>
  );
}
