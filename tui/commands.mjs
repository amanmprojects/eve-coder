/**
 * Slash-command registry.
 *
 * The registry is the single source of truth for three consumers: `/help`,
 * the dispatcher, and pi-tui's `CombinedAutocompleteProvider` (which renders the
 * interactive dropdown). Adding a command here makes it complete, document, and
 * dispatch itself.
 *
 * Handlers receive the app controller rather than importing the client, which
 * keeps this module free of cycles.
 */
import { loadSessions } from "./sessions.mjs";

function onOffCompletions(prefix) {
  return ["on", "off"]
    .filter((v) => v.startsWith(prefix.toLowerCase()))
    .map((v) => ({ value: v, label: v }));
}

/**
 * Build the command list bound to an app controller.
 *
 * Each entry is both a dispatch target and a pi-tui `SlashCommand`. Names are
 * bare (no leading `/`): `CombinedAutocompleteProvider.applyCompletion` prepends
 * the slash itself, and its argument-completion lookup matches the bare name.
 */
export function buildCommands(app) {
  return [
    {
      name: "help",
      description: "show commands and keys",
      run: () => app.help(),
    },
    {
      name: "new",
      description: "start a fresh session",
      run: () => app.newSession(),
    },
    {
      name: "resume",
      description: "resume a previous session",
      argumentHint: "<number|id|label>",
      run: (arg) => app.resume(arg),
      getArgumentCompletions: (prefix) =>
        loadSessions()
          .map((s, i) => ({
            value: String(i + 1),
            label: `${i + 1}. ${s.label ?? s.id.slice(0, 12)}`,
            description: s.id.slice(0, 12),
          }))
          .filter((item) => !prefix || item.label.toLowerCase().includes(prefix.toLowerCase())),
    },
    {
      name: "sessions",
      description: "list saved sessions",
      run: () => app.listSessions(),
    },
    {
      name: "model",
      description: "show the model in use",
      run: () => app.showModel(),
    },
    {
      name: "effort",
      description: "show the reasoning effort in use",
      run: () => app.showEffort(),
    },
    {
      name: "reasoning",
      description: "show or hide reasoning traces",
      argumentHint: "[on|off]",
      run: (arg) => app.setShowReasoning(arg),
      getArgumentCompletions: onOffCompletions,
    },
    {
      name: "expand",
      description: "expand or collapse tool output (same as ctrl+o)",
      argumentHint: "[on|off]",
      run: (arg) => app.setExpanded(arg),
      getArgumentCompletions: onOffCompletions,
    },
    {
      name: "tools",
      description: "list the tools the agent can call",
      run: () => app.listTools(),
    },
    {
      name: "compact",
      description: "compact this session's context",
      run: () => app.compact(),
    },
    {
      name: "clear",
      description: "clear history, keep the session",
      run: () => app.clearHistory(),
    },
    {
      name: "cancel",
      description: "stop the current turn",
      run: () => app.cancel(),
    },
    {
      name: "quit",
      description: "exit eve-coder",
      run: () => app.quit(),
    },
  ];
}

/**
 * Split raw input into a bare command name and its argument.
 * Returns null when the text is not a slash command.
 */
export function parseCommand(raw) {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("/")) return null;
  const match = /^\/([a-zA-Z][\w:-]*)\s*([\s\S]*)$/.exec(text);
  if (!match) return { name: text.slice(1).toLowerCase(), arg: "" };
  return { name: match[1].toLowerCase(), arg: match[2].trim() };
}

/**
 * Interpret an on/off/toggle argument.
 * An empty argument toggles, which is what bare `/reasoning` should do.
 */
export function parseToggle(arg, current) {
  const v = String(arg ?? "").trim().toLowerCase();
  if (v === "" || v === "toggle") return !current;
  if (["on", "yes", "true", "show", "1"].includes(v)) return true;
  if (["off", "no", "false", "hide", "0"].includes(v)) return false;
  return null;
}
