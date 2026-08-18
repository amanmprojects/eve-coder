import { defineAgent } from "eve";

export default defineAgent({
  model: "zai/glm-5.2",
  // The AI Gateway catalog reports zai/glm-5.2's context window as 1M (taken
  // from the first listed provider, alibaba), but we route exclusively through
  // blackbox — whose effective input ceiling is 256K (262,144 tokens). GLM 5.2's
  // full 1M context is an opt-in `[1m]` mode that blackbox does not expose, so
  // requests above ~262K prompt tokens are rejected with "exceeds the context
  // window". Override the catalog value here so the footer percentage is honest
  // and, more importantly, so eve's auto-compaction threshold (90% of the
  // window = ~236K) fires *before* the real ceiling is hit.
  modelContextWindowTokens: 262144,
  // Route zai/glm-5.2 exclusively through the blackbox provider via the
  // Vercel AI Gateway. The default alibaba provider is not available to this
  // key's free tier; blackbox is. (`only` restricts routing to one provider.)
  modelOptions: {
    providerOptions: {
      gateway: {
        only: ["blackbox"],
      },
    },
  },
  // NOTE: this whole config is evaluated by `eve build` and baked into
  // .output/server as a static manifest — reading process.env here does nothing
  // at runtime (verified: EVE_CODER_REASONING/EVE_CODER_MODEL are ignored by the
  // built server). To change the model or effort, edit this file and rebuild, or
  // run `eve set --reasoning <level>` followed by `npm run build`.
  reasoning: "xhigh",
});
