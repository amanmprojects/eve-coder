import { defineAgent } from "eve";

export default defineAgent({
  model: "zai/glm-5.2",
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
