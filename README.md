# eve-coder

A **fully-local** coding agent built on [eve](https://eve.dev). No sandbox, no
VM: it operates directly on the directory you run it from, as the current user.

```bash
npm i -g eve-coder
```

Then go to any project and start working:

```bash
cd ~/code/my-project
eve-coder                 # opens the TUI; the agent edits THIS directory
eve-coder --input "refactor this module"   # optionally seed the first message
```

## What it does

- **Runs anywhere**: `eve-coder` captures the directory you launch it from and
  sets it as the agent's workspace (`LOCAL_CODER_ROOT`). Override with
  `LC_ROOT` if you want a fixed workspace.
- **TUI**: an interactive terminal UI opens in your shell (the same way
  `pi` does).
- **Real host access (no sandbox)**: the agent has `bash`, `read_file`,
  `write_file`, `edit_file`, `glob`, `grep`, and `ls` implemented as local
  tools that touch the machine's actual filesystem. Treat it with care —
  every command runs with your privileges. See the agent's instructions for
  its safety rules (ask before destructive/irreversible actions).

## Configuration

The model routes through the Vercel AI Gateway using `AI_GATEWAY_API_KEY`.

If `AI_GATEWAY_API_KEY` is **not** already in your environment, `eve-coder`
loads unset variables from the first existing file of:

- `~/.config/eve-coder/env`
- `~/.eve-coder.env`

```bash
mkdir -p ~/.config/eve-coder
echo 'AI_GATEWAY_API_KEY=...' > ~/.config/eve-coder/env
```

Variables already exported in your shell take precedence.

## How it runs

The published package ships a **prebuilt** server (built with `eve build`), so
`eve-coder` needs no compilation at runtime:

1. it starts the built server on `127.0.0.1` at a fresh random port,
2. it attaches the interactive TUI to that server,
3. when you quit the TUI, the server shuts down.

Server logs live in `~/.local/state/eve-coder/server.log`.

The eve HTTP channel accepts anonymous requests on the loopback interface
(`none()` as a final auth fallback). That is safe as long as the server stays
bound to `127.0.0.1` — do **not** point it at a public interface or tunnel it
without adding `httpBasic()`/`jwtHmac()` to `agent/channels/eve.ts` first,
since the agent can read and write the whole machine.

## Model

The root agent uses `zai/glm-5.2` via the AI Gateway, routed through the
`blackbox` provider (see `agent/agent.ts`). Change the model there or with
`eve set --model ...`.

## Tune the workspace

| Env var | Default | Meaning |
| --- | --- | --- |
| `LC_ROOT` | your launch directory | workspace the agent operates on |
| `LC_AGENT_DIR` | n/a | point the bundled CLI at a different eve agent (advanced) |

## Security

This is a local agent with **no sandbox isolation**. It runs `bash` as your
user and can read/write anything you can. Keep `agent/instructions.md`'s
safety rules, and consider gating `bash` with `eve/tools/approval`'s
`always()` if you want a confirmation on every command.

## For maintainers

```bash
npm pack                 # inspect what ships (no .env*, no .eve)
npm publish              # runs `npm run build` (prepublishOnly), then publishes
```
