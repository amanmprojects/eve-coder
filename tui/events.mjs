/**
 * eve stream event → UI reducer.
 *
 * Everything the shell shows is derived here from the NDJSON stream, and only
 * from it: reasoning text from `reasoning.appended`, tool inputs from
 * `actions.requested`, tool output from `action.partial`/`action.result`, usage
 * from `step.completed`, and the live model id from `step.started`.
 *
 * Tool lifecycles are correlated by `callId`, and events are de-duplicated by
 * `meta.id` because a resume replays a snapshot that can overlap the follow
 * stream.
 */
import { color } from "./theme.mjs";

/** Bound on the dedupe set; a session's stream is longer than we need to recall. */
const SEEN_LIMIT = 20000;

class SeenSet {
  constructor(limit = SEEN_LIMIT) {
    this.limit = limit;
    this.ids = new Set();
    this.order = [];
  }

  /** True when this id has already been handled. */
  check(id) {
    if (!id) return false;
    if (this.ids.has(id)) return true;
    this.ids.add(id);
    this.order.push(id);
    if (this.order.length > this.limit) {
      const evicted = this.order.splice(0, Math.floor(this.limit / 2));
      for (const old of evicted) this.ids.delete(old);
    }
    return false;
  }

  clear() {
    this.ids.clear();
    this.order.length = 0;
  }
}

/** Human label for one requested action. */
function actionTarget(action) {
  switch (action?.kind) {
    case "tool-call":
      return { name: action.toolName ?? "tool", input: action.input };
    case "subagent-call":
      return {
        name: action.subagentName ?? action.name ?? "subagent",
        input: action.input ?? { description: action.description },
      };
    case "remote-agent-call":
      return {
        name: action.remoteAgentName ?? action.name ?? "remote-agent",
        input: action.input ?? { description: action.description },
      };
    case "load-skill":
      return { name: "load_skill", input: action.input };
    default:
      return { name: action?.kind ?? "action", input: action?.input };
  }
}

/** Human label for one action result. */
function resultTarget(result) {
  switch (result?.kind) {
    case "tool-result":
      return result.toolName ?? "tool";
    case "subagent-result":
      return result.subagentName ?? "subagent";
    case "load-skill-result":
      return result.name ?? "load_skill";
    default:
      return "action";
  }
}

/**
 * Build the event handler.
 *
 * `app` supplies the pieces the reducer drives plus a few callbacks for state
 * the client owns (busy flag, pending HITL requests, session recovery).
 */
export function createEventHandler(app) {
  const seen = new SeenSet();
  /**
   * Whether the current message/reasoning burst has already been rendered.
   *
   * eve emits `*.completed` with the full text at the end of a step, which can
   * land after a tool block already closed the live component. Without this,
   * that terminal event re-renders text the stream already showed.
   */
  let renderedMessage = false;
  let renderedReasoning = false;

  function handle(event) {
    if (!event || typeof event !== "object") return;
    if (seen.check(event.meta?.id)) return;

    const data = event.data ?? {};
    const { transcript, footer, status } = app;

    switch (event.type) {
      // --- assistant output ------------------------------------------------
      case "message.appended":
        transcript.assistantDelta(data.messageSoFar ?? data.messageDelta ?? "");
        renderedMessage = true;
        status.set("responding", { busy: true });
        break;

      case "message.completed":
        // A short reply can complete without ever appending; render it once here.
        if (!renderedMessage && data.message) transcript.assistantDelta(data.message);
        transcript.closeAssistant();
        renderedMessage = false;
        break;

      // --- reasoning -------------------------------------------------------
      case "reasoning.appended":
        transcript.reasoningDelta(data.reasoningSoFar ?? data.reasoningDelta ?? "");
        renderedReasoning = true;
        status.set("thinking", { busy: true });
        break;

      case "reasoning.completed":
        if (!renderedReasoning && data.reasoning) transcript.reasoningDelta(data.reasoning);
        transcript.closeReasoning();
        renderedReasoning = false;
        break;

      // --- model call bookkeeping -----------------------------------------
      case "step.started":
        if (data.modelId) footer.setModel(data.modelId);
        status.set("thinking", { busy: true });
        break;

      case "step.completed":
        footer.recordStep(data.usage);
        break;

      case "step.failed":
        transcript.notice(`✗ step failed [${data.code ?? "?"}]: ${data.message ?? "unknown"}`, "error");
        break;

      // --- tools -----------------------------------------------------------
      case "actions.requested": {
        const actions = Array.isArray(data.actions) ? data.actions : [];
        for (const action of actions) {
          if (!action?.callId) continue;
          const { name, input } = actionTarget(action);
          transcript.toolStart(action.callId, name, input);
        }
        if (actions.length > 0) {
          const first = actionTarget(actions[0]).name;
          status.set(
            actions.length === 1 ? `running ${first}` : `running ${actions.length} tools`,
            { busy: true },
          );
        }
        break;
      }

      case "action.partial": {
        const result = data.result;
        if (result?.callId) {
          transcript.toolPartial(result.callId, resultTarget(result), result.output);
        }
        break;
      }

      case "action.result": {
        const result = data.result;
        if (result?.callId) {
          transcript.toolResult(result.callId, resultTarget(result), {
            output: result.output,
            status: data.status,
            isError: result.isError,
            error: data.error,
          });
        }
        status.set("thinking", { busy: true });
        break;
      }

      // --- turn lifecycle --------------------------------------------------
      case "turn.started":
        app.setBusy(true);
        status.set("working", { busy: true });
        break;

      case "turn.completed":
        transcript.closeLive();
        app.setBusy(false);
        status.clear();
        break;

      case "turn.failed":
        transcript.closeLive();
        transcript.notice(
          `✗ turn failed [${data.code ?? "?"}]: ${data.message ?? "unknown error"}`,
          "error",
        );
        app.setBusy(false);
        status.clear();
        break;

      case "turn.cancelled":
        transcript.closeLive();
        transcript.notice("⏹ cancelled", "warning");
        app.setBusy(false);
        status.clear();
        break;

      // --- compaction ------------------------------------------------------
      case "compaction.requested":
        transcript.notice("… compacting context", "customMessageLabel");
        app.setBusy(true);
        status.set("compacting", { busy: true });
        break;

      case "compaction.completed":
        transcript.notice("✓ context compacted", "customMessageLabel");
        app.setBusy(false);
        status.clear();
        break;

      // --- human-in-the-loop ------------------------------------------------
      case "input.requested": {
        const requests = Array.isArray(data.requests) ? data.requests : [];
        app.setPendingRequests(requests);
        for (const request of requests) {
          transcript.notice(`❓ ${request.prompt ?? "the agent needs input"}`, "cyan");
          const options = Array.isArray(request.options) ? request.options : [];
          options.forEach((option, i) => {
            const desc = option.description ? color("dim", ` — ${option.description}`) : "";
            transcript.notice(`   ${i + 1}. ${option.label ?? option.id}${desc}`, "text");
          });
          if (options.length > 0) {
            transcript.notice(
              request.allowFreeform
                ? "   reply with a number, or type an answer"
                : "   reply with a number",
              "dim",
            );
          }
        }
        app.setBusy(false);
        status.set("waiting for you", { busy: false });
        break;
      }

      // --- session lifecycle ------------------------------------------------
      case "session.waiting":
        app.setBusy(false);
        status.clear();
        break;

      case "session.completed":
        transcript.notice("— session ended (use /new or /resume)", "muted");
        app.setBusy(false);
        status.clear();
        break;

      case "session.failed":
        transcript.notice(
          `✗ session failed [${data.code ?? "?"}: ${data.message ?? "unknown"}] — the next message starts a fresh session.`,
          "error",
        );
        app.onSessionFailed(data.sessionId);
        app.setBusy(false);
        status.clear();
        break;

      default:
        break;
    }
  }

  handle.resetSeen = () => seen.clear();
  return handle;
}
