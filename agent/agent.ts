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
  reasoning: "xhigh",
});
