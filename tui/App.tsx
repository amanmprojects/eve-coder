import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEveAgent } from "eve/react";
import { Client } from "eve/client";
import { theme } from "./theme";
import { Omnibar } from "./components/Omnibar";
import { AppFooter } from "./components/AppFooter";
import { ScrollableMessageList } from "./components/ScrollableMessageList";
import { ModelNameProvider } from "./hooks/useModelName";
import { usePrefs } from "./hooks/usePrefs";
import { useUsage } from "./hooks/useUsage";
import { commands, parseCommand, parseToggle } from "./commands";
import { saveSession, labelFor } from "./hooks/useSessions";

const WORKSPACE = process.env.LOCAL_CODER_ROOT ?? process.cwd();
const SERVER_URL = process.env.EVE_CODER_SERVER_URL ?? "";
const DEFAULT_MODEL = "zai/glm-5.2";
const DEFAULT_EFFORT = "xhigh";

const HINTS = `Welcome to eve-coder. Type a message, or /help for commands.`;

function AppShell() {
  const { width: termWidth } = useTerminalDimensions();
  const [inputValue, setInputValue] = useState("");
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<{ model: string; effort: string; contextWindow: number }>({
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    contextWindow: 262144,
  });
  const clientRef = useRef<Client | null>(null);

  // Fetch agent info once on mount
  useEffect(() => {
    if (!SERVER_URL) return;
    const client = new Client({ host: SERVER_URL });
    clientRef.current = client;
    client
      .info()
      .then((info) => {
        const model = (info as { agent?: { model?: { id?: string; reasoning?: string; contextWindowTokens?: number } } })
          .agent?.model;
        if (model) {
          setModelInfo({
            model: model.id ?? DEFAULT_MODEL,
            effort: model.reasoning ?? DEFAULT_EFFORT,
            contextWindow: model.contextWindowTokens ?? 262144,
          });
        }
      })
      .catch(() => {});
  }, []);

  // useEveAgent does the heavy lifting: session lifecycle, streaming, event projection
  const agent = useEveAgent({
    host: SERVER_URL,
    onSessionChange: (session) => {
      if (session?.sessionId) {
        const firstUserMsg = agent.data.messages.find((m) => m.role === "user");
        const textPart = firstUserMsg?.parts.find((p) => p.type === "text");
        saveSession({
          id: session.sessionId,
          streamIndex: session.streamIndex ?? 0,
          label: labelFor(textPart?.text ?? null, session.sessionId.slice(0, 8)),
          cwd: WORKSPACE,
          ts: Date.now(),
        });
      }
    },
  });

  const { prefs, update } = usePrefs();
  const { statsLeft } = useUsage(agent.events, modelInfo.contextWindow);

  const isBusy = agent.status === "streaming" || agent.status === "submitted";
  const errorMessage = commandFeedback ?? (agent.status === "error" && agent.error ? agent.error.message : null);
  const sessionId = agent.session?.sessionId ?? null;

  // Palette navigation state (up/down/tab/enter selection)
  const [paletteIndex, setPaletteIndex] = useState(0);
  const isPalette = inputValue.startsWith("/");

  // Build the filtered palette here too, so we can navigate it
  const paletteEntries = useMemo(() => {
    if (!isPalette) return [];
    const typed = inputValue.slice(1);
    const hasSpace = /\s/.test(typed);
    const namePart = hasSpace ? typed.split(/\s/)[0]! : typed;
    const query = namePart.toLowerCase();
    return commands
      .filter((c) => c.name.startsWith(query))
      .map((c) => ({
        name: c.name,
        value: c.argumentHint ? `/${c.name} ` : `/${c.name}`,
        fill: Boolean(c.argumentHint),
      }));
  }, [inputValue, isPalette]);

  // Reset palette index when input changes
  useEffect(() => {
    setPaletteIndex(0);
  }, [inputValue]);

  // Keyboard shortcuts
  useKeyboard((key) => {
    // Palette navigation when slash menu is open
    if (isPalette && paletteEntries.length > 0) {
      if (key.name === "up" || (key.ctrl && key.name === "p")) {
        key.preventDefault();
        setPaletteIndex((i) => (i <= 0 ? paletteEntries.length - 1 : i - 1));
        return;
      }
      if (key.name === "down" || (key.ctrl && key.name === "n")) {
        key.preventDefault();
        setPaletteIndex((i) => (i >= paletteEntries.length - 1 ? 0 : i + 1));
        return;
      }
      if (key.name === "tab") {
        key.preventDefault();
        const entry = paletteEntries[Math.min(paletteIndex, paletteEntries.length - 1)];
        if (entry) setInputValue(entry.value);
        return;
      }
    }

    // Ctrl+O: toggle expand
    if (key.ctrl && key.name === "o") {
      key.preventDefault();
      update({ expandTools: !prefs.expandTools });
    }
    // Ctrl+R: toggle reasoning
    if (key.ctrl && key.name === "r") {
      key.preventDefault();
      update({ showReasoning: !prefs.showReasoning });
    }
    // Escape: interrupt if busy, otherwise clear input
    if (key.name === "escape") {
      if (isBusy) {
        key.preventDefault();
        agent.cancel().catch(() => {});
      } else if (inputValue) {
        key.preventDefault();
        setInputValue("");
        setCommandFeedback(null);
      }
    }
    // Ctrl+C: cancel if busy, otherwise exit
    if (key.ctrl && key.name === "c") {
      if (isBusy) {
        key.preventDefault();
        agent.cancel().catch(() => {});
      }
    }
    // Ctrl+D: exit on empty input
    if (key.ctrl && key.name === "d") {
      if (inputValue.length === 0) {
        key.preventDefault();
        process.exit(0);
      }
    }
  });

  const runSlashCommand = useCallback(
    async (raw: string): Promise<boolean> => {
      const parsed = parseCommand(raw);
      if (!parsed) return false;
      const { name, arg } = parsed;

      const cmd = commands.find((c) => c.name === name);
      if (!cmd) {
        setCommandFeedback(`Unknown command: /${name}. Try /help.`);
        return true;
      }

      switch (name) {
        case "help": {
          const lines = ["Commands:"];
          for (const c of commands) {
            const nm = `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ""}`;
            lines.push(`  ${nm.padEnd(30)} ${c.description}`);
          }
          lines.push("", "Keys:", "  esc         interrupt", "  ctrl+c      cancel", "  ctrl+d      exit", "  ctrl+o      expand/collapse tool output", "  ctrl+r      show/hide reasoning");
          setCommandFeedback(lines.join("\n"));
          break;
        }
        case "reasoning": {
          const next = parseToggle(arg, prefs.showReasoning);
          if (next === null) {
            setCommandFeedback(`unknown value "${arg}" — use on or off`);
          } else {
            update({ showReasoning: next });
          }
          break;
        }
        case "expand": {
          const next = parseToggle(arg, prefs.expandTools);
          if (next === null) {
            setCommandFeedback(`unknown value "${arg}" — use on or off`);
          } else {
            update({ expandTools: next });
          }
          break;
        }
        case "model":
          setCommandFeedback(`model: ${modelInfo.model} (baked in at build time)`);
          break;
        case "effort":
          setCommandFeedback(`reasoning effort: ${modelInfo.effort} (baked in at build time)`);
          break;
        case "sessions": {
          const { loadSessions } = await import("./hooks/useSessions");
          const list = loadSessions();
          if (list.length === 0) {
            setCommandFeedback("(no saved sessions yet)");
          } else {
            const lines = list.map((s, i) => `${String(i + 1).padStart(2)} ${s.id.slice(0, 12)} ${s.label ?? ""}`);
            lines.push("/resume <number|id> to reopen one");
            setCommandFeedback(lines.join("\n"));
          }
          break;
        }
        default:
          cmd.run(arg, agent);
          break;
      }
      setInputValue("");
      return true;
    },
    [agent, prefs, update, modelInfo],
  );

  const handleSubmit = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;

      if (text.startsWith("/")) {
        void runSlashCommand(text);
        return;
      }

      if (isBusy) {
        setCommandFeedback("Wait for the current response to finish (or press esc to interrupt).");
        return;
      }

      setCommandFeedback(null);
      setInputValue("");
      void agent.send(text);
    },
    [agent, isBusy, runSlashCommand],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      if (commandFeedback) setCommandFeedback(null);
      setInputValue(value);
    },
    [commandFeedback],
  );

  // Auto-clear command feedback
  useEffect(() => {
    if (!commandFeedback) return;
    const t = setTimeout(() => setCommandFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [commandFeedback]);

  return (
    <box flexDirection="row" flexGrow={1} backgroundColor={theme.bg} minHeight={0} width="100%">
      <box
        flexDirection="column"
        flexGrow={1}
        minWidth={0}
        minHeight={0}
        flexShrink={1}
        paddingX={2}
      >
        {agent.data.messages.length === 0 && !isBusy ? (
          <box flexGrow={1} backgroundColor={theme.bg} height="100%" alignItems="center" justifyContent="center">
            <text fg={theme.accent}>eve-coder</text>
            <text fg={theme.dim}>{"\n" + HINTS}</text>
          </box>
        ) : (
          <ScrollableMessageList messages={agent.data.messages} status={agent.status} />
        )}

        <box paddingX={0} paddingY={1} flexShrink={0} flexDirection="column" gap={0}>
          {commandFeedback ? (
            <box marginBottom={1} border={["left"]} borderColor={theme.borderSubtle} borderStyle="single" paddingX={2}>
              <text fg={theme.text}>{commandFeedback}</text>
            </box>
          ) : null}
          <Omnibar
            value={inputValue}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            status={agent.status}
            errorMessage={errorMessage}
            paletteIndex={paletteIndex}
          />
          <AppFooter
            statsLeft={statsLeft}
            model={modelInfo.model}
            effort={modelInfo.effort}
            workspace={WORKSPACE}
            sessionId={sessionId}
          />
        </box>
      </box>
    </box>
  );
}

export function App() {
  return (
    <ModelNameProvider modelId={DEFAULT_MODEL} modelName={DEFAULT_MODEL}>
      <AppShell />
    </ModelNameProvider>
  );
}
