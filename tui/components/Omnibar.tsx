import { useState, useEffect } from "react";
import type { InputProps } from "@opentui/react";
import { theme } from "../theme";
import { useModelName } from "../hooks/useModelName";
import { commands } from "../commands";

interface OmnibarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  status: "ready" | "streaming" | "submitted" | "error";
  errorMessage?: string | null;
  placeholder?: string;
  width?: number | string;
  paletteIndex?: number;
  onPaletteIndexChange?: (index: number) => void;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface PaletteEntry {
  name: string;
  description: string;
  argumentHint?: string;
  /** Full slash command string to run or fill. */
  value: string;
  /** Whether enter runs it or fills the input. */
  fill: boolean;
}

/** Build filtered palette entries from the current input. */
function buildPalette(input: string): PaletteEntry[] {
  if (!input.startsWith("/")) return [];
  // Strip leading "/" and everything after the first space for matching.
  const typed = input.slice(1);
  const hasSpace = /\s/.test(typed);
  // Once the user types a space, the command name is decided — no more filtering.
  const namePart = hasSpace ? typed.split(/\s/)[0]! : typed;
  const query = namePart.toLowerCase();

  return commands
    .filter((c) => c.name.startsWith(query))
    .map((c) => {
      const full = `/${c.name}`;
      const needsArgs = Boolean(c.argumentHint);
      return {
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
        value: needsArgs ? `${full} ` : full,
        fill: needsArgs,
      };
    });
}

export function Omnibar({
  value,
  onChange,
  onSubmit,
  status,
  errorMessage,
  placeholder = "Message…  (/ for commands)",
  width = "100%",
  paletteIndex = 0,
}: OmnibarProps) {
  const modelName = useModelName();
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const isBusy = status === "streaming" || status === "submitted";
  const isPalette = value.startsWith("/");

  const palette = isPalette ? buildPalette(value) : [];

  // Spinner animation
  useEffect(() => {
    if (!isBusy) return;
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [isBusy]);

  const statusHint = status === "error" ? "error" : isBusy ? "running" : "ready";
  const safeIndex = Math.min(paletteIndex, Math.max(0, palette.length - 1));

  return (
    <box flexDirection="column" alignItems="stretch" width="100%">
      <box position="relative" width="100%" flexShrink={0}>
        {/* Palette popup (above the input) */}
        {isPalette && palette.length > 0 ? (
          <box
            position="absolute"
            left={0}
            right={0}
            bottom="100%"
            marginBottom={0}
            zIndex={100}
            overflow="visible"
            border={true}
            borderColor={theme.borderSubtle}
            borderStyle="single"
            backgroundColor={theme.bg}
          >
            <box flexDirection="column" paddingX={1} paddingY={0}>
              {palette.slice(0, 10).map((entry, i) => {
                const isSelected = i === safeIndex;
                const label = `/${entry.name}${entry.argumentHint ? ` ${entry.argumentHint}` : ""}`;
                return (
                  <box key={entry.name} flexDirection="row" gap={1}>
                    <text fg={isSelected ? theme.accent : theme.text}>
                      {isSelected ? "▸" : " "}
                    </text>
                    <text fg={isSelected ? theme.accent : theme.text}>
                      {label.padEnd(22, " ")}
                    </text>
                    <text fg={theme.dim}>
                      {entry.description}
                    </text>
                  </box>
                );
              })}
              <text fg={theme.subtle}>
                {" ↑↓ navigate · tab fill · enter run · esc close"}
              </text>
            </box>
          </box>
        ) : null}

        {/* Input bar */}
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
      </box>
    </box>
  );
}
