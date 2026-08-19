import type { ReactNode } from "react";
import type { BorderSides, BorderStyle, RGBA } from "@opentui/core";
import { theme } from "../theme";

type MessageFrameBase = {
  children: ReactNode;
  backgroundColor?: string | RGBA;
  paddingY?: number;
};

type MessageFrameBorderedProps = MessageFrameBase & {
  border?: true | BorderSides[];
  borderColor?: string | RGBA;
  borderStyle?: BorderStyle;
};

type MessageFramePlainProps = MessageFrameBase & {
  border: false;
  borderColor?: never;
  borderStyle?: never;
};

export type MessageFrameProps = MessageFrameBorderedProps | MessageFramePlainProps;

const DEFAULT_BORDER_COLOR = theme.borderSubtle;
const DEFAULT_BORDER_STYLE: BorderStyle = "single";

export function MessageFrame(props: MessageFrameProps) {
  const { children, backgroundColor = theme.bg, paddingY = 0 } = props;

  if (props.border === false) {
    return (
      <box
        flexShrink={0}
        border={false}
        backgroundColor={backgroundColor}
        paddingX={2}
        paddingY={paddingY}
      >
        {children}
      </box>
    );
  }

  const border = props.border ?? true;
  const borderColor = props.borderColor ?? DEFAULT_BORDER_COLOR;
  const borderStyle = props.borderStyle ?? DEFAULT_BORDER_STYLE;

  return (
    <box
      flexShrink={0}
      border={border}
      borderColor={borderColor}
      borderStyle={borderStyle}
      backgroundColor={backgroundColor}
      paddingX={2}
      paddingY={paddingY}
    >
      {children}
    </box>
  );
}
