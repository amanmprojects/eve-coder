import type { UseEveAgentHelpers } from "eve/react";
import type { EveMessageData } from "eve/react";
import { loadSessions } from "../hooks/useSessions";

export interface CommandDef {
  name: string;
  description: string;
  argumentHint?: string;
  run: (arg: string, agent: UseEveAgentHelpers<EveMessageData>) => Promise<void> | void;
}

export const commands: CommandDef[] = [
  {
    name: "help",
    description: "show commands and keys",
    run: () => {},
  },
  {
    name: "new",
    description: "start a fresh session",
    run: (_arg, agent) => agent.reset(),
  },
  {
    name: "sessions",
    description: "list saved sessions",
    run: () => {},
  },
  {
    name: "resume",
    description: "resume a previous session",
    argumentHint: "<number|id|label>",
    run: () => {},
  },
  {
    name: "model",
    description: "show the model in use",
    run: () => {},
  },
  {
    name: "effort",
    description: "show the reasoning effort",
    run: () => {},
  },
  {
    name: "reasoning",
    description: "show or hide reasoning traces",
    argumentHint: "[on|off]",
    run: () => {},
  },
  {
    name: "expand",
    description: "expand or collapse tool output (same as ctrl+o)",
    argumentHint: "[on|off]",
    run: () => {},
  },
  {
    name: "tools",
    description: "list the tools the agent can call",
    run: () => {},
  },
  {
    name: "compact",
    description: "compact this session's context",
    run: () => {},
  },
  {
    name: "clear",
    description: "clear history, keep the session",
    run: () => {},
  },
  {
    name: "cancel",
    description: "stop the current turn",
    run: (_arg, agent) => agent.cancel(),
  },
  {
    name: "quit",
    description: "exit eve-coder",
    run: () => process.exit(0),
  },
];

export function parseCommand(raw: string): { name: string; arg: string } | null {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("/")) return null;
  const match = /^\/([a-zA-Z][\w:-]*)\s*([\s\S]*)$/.exec(text);
  if (!match) return { name: text.slice(1).toLowerCase(), arg: "" };
  return { name: match[1]!.toLowerCase(), arg: match[2]!.trim() };
}

export function parseToggle(arg: string, current: boolean): boolean | null {
  const v = String(arg ?? "").trim().toLowerCase();
  if (v === "" || v === "toggle") return !current;
  if (["on", "yes", "true", "show", "1"].includes(v)) return true;
  if (["off", "no", "false", "hide", "0"].includes(v)) return false;
  return null;
}
