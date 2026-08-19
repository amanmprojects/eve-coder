import { useState } from "react";
import type { InputProps } from "@opentui/react";
import { theme } from "../theme";
import { useModelName } from "../hooks/useModelName";

interface OmnibarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  status: "ready" | "streaming" | "submitted" | "error";
  errorMessage?: string | null;
  placeholder?: string;
  width?: number | string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Omnibar({
  value,
  onChange,
  onSubmit,
  status,
  errorMessage,
  placeholder = "Message…  (/ for commands)",
  width = "100%",
}: OmnibarProps) {
  const modelName = useModelName();
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const isBusy = status === "streaming" || status === "submitted";
  const isPalette = value.startsWith("/");

  // Simple spinner via state interval
  if (isBusy && spinnerFrame < SPINNER_FRAMES.length - 1) {
    setTimeout(() => setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
  }

  const statusHint = status === "error" ? "error" : isBusy ? "running" : "ready";

  // Build palette items from commands
  const paletteItems: string[] = isPalette
    ? ["/help", "/new", "/sessions", "/resume", "/model", "/effort", "/reasoning", "/expand", "/tools", "/compact", "/clear", "/cancel", "/quit"]
        .filter((c) => c.startsWith(value.slice(0, Math.max(value.length, 1))))
    : [];

  return (
    <box flexDirection="column" alignItems="stretch" width="100%">
      <box position="relative" width="100%" flexShrink={0}>
        <box
          flexDirection="row"
          width="100%"
          alignItems="stretch"
          border={["left"]}
          borderColor={status === "error" ? theme.warning : theme.accent}
          borderStyle="heavy"
        >
          <box
            flexGrow={1}
            flexShrink={1}
            paddingX={2}
            flexDirection="column"
            gap={1}
            border={["top", "bottom"]}
            borderColor={theme.panel}
            borderStyle="single"
            backgroundColor={theme.panel}
          >
            <input
              value={value}
              onInput={onChange}
              onSubmit={onSubmit as NonNullable<InputProps["onSubmit"]>}
              placeholder={placeholder}
              focused
              backgroundColor={theme.panel}
              textColor={theme.text}
              placeholderColor={theme.muted}
              cursorColor={theme.cursor}
            />
            <box flexDirection="row" alignItems="center" gap={1}>
              <text fg={theme.dim} flexShrink={1}>
                <span fg={theme.accent}>{isBusy ? SPINNER_FRAMES[spinnerFrame]! : "▣"}</span>
                {"  "}
                <span fg={theme.text}>{modelName}</span>
                {" · "}
                <span fg={isBusy ? theme.warning : theme.dim}>{statusHint}</span>
              </text>
            </box>
            {errorMessage ? (
              <text fg={theme.error}>{errorMessage}</text>
            ) : null}
          </box>
        </box>

        {isPalette && paletteItems.length > 0 ? (
          <box
            position="absolute"
            left={0}
            right={0}
            bottom="100%"
            zIndex={100}
            overflow="visible"
            border={true}
            borderColor={theme.borderSubtle}
            borderStyle="single"
            backgroundColor={theme.bg}
          >
            <box flexDirection="column" paddingX={2} paddingY={1}>
              {paletteItems.slice(0, 8).map((item) => (
                <text key={item} fg={theme.text}>
                  {item}
                </text>
              ))}
            </box>
          </box>
        ) : null}
      </box>
    </box>
  );
}
