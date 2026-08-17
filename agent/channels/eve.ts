import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // eve-coder runs as a personal LOCAL CLI: the prebuilt server (eve start)
    // is bound to 127.0.0.1, so we fall through to anonymous requests from the
    // local loopback. If you ever expose this server beyond localhost (e.g.
    // --host 0.0.0.0 or a tunnel), replace none() with httpBasic()/jwtHmac()
    // first — the agent can read/write the whole machine.
    none(),
  ],
});
