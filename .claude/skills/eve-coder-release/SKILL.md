---
name: eve-coder-release
description: Push eve-coder changes to GitHub and publish/install the package. Use after every change to this repo (~/eve-coder) — commit + push to main, rebuild the release tarball, re-upload it to the GitHub release, and install from the release URL. Also covers how to install eve-coder on any machine without an npm login.
---

# eve-coder release workflow

This package is distributed as a **GitHub release tarball**, not via the npm
registry. `npm login` is impossible on this machine (passkey needs the iPhone),
and the npm-registry `eve-coder` (1.3.0) is a broken build anyway. `npm pack`
and `gh` need **no login** — they are the publish path.

Working clone: `~/eve-coder` (origin = `https://github.com/amanmprojects/eve-coder.git`, branch `main`, `gh` CLI authenticated as `amanmprojects`).

## After every change

1. **Test locally first.** Run `eve-coder` from the repo (or reinstall the tarball, below) and exercise the changed path. For a model-roundtrip smoke test: open the TUI, send `Reply with exactly: session-ok`, expect that reply back, then `/quit`.
2. **Commit + push:**
   ```sh
   cd ~/eve-coder
   git add -A
   git commit -m "<what and why>"
   git push origin HEAD
   ```
   Confirm: `git fetch origin && git log origin/main -1` shows your commit.
3. **If the change affects the shipped package** (anything in `bin/`, `agent/`, `tui/`, `tsconfig.json`, `package.json` — anything in the `files` list), rebuild + repack + re-upload the release asset:
   ```sh
   cd ~/eve-coder
   npm run build                 # regenerates .output
   npm pack                      # produce eve-coder-<version>.tgz
   gh release upload v<version> eve-coder-<version>.tgz --clobber
   ```
   For a meaningful release, bump `package.json` `version` first (patch for fixes, minor for features), then create a new release:
   ```sh
   gh release create v<new-version> eve-coder-<new-version>.tgz \
     --title "eve-coder <new-version>" --notes "<summary>"
   ```
4. **Skip the repack** for `.agents/`, `*.md` docs, and other files not in `files` — they don't ship in the tarball.
5. **Verify the tarball:** `tar -tvzf eve-coder-<version>.tgz | grep bin/eve-coder.mjs` must show `-rwxr-xr-x`. If it shows `-rw-r--r--`, run `chmod +x bin/eve-coder.mjs`, commit, repack, re-upload (git tracks the exec bit; npm pack preserves it; a 0644 launcher dies with exit 126 on install).

## Install from GitHub (any machine, no npm account)

```sh
sudo npm i -g https://github.com/amanmprojects/eve-coder/releases/download/v<version>/eve-coder-<version>.tgz
```

Keep `<version>` in the URL in sync with `package.json`. The npm 11
`allow-scripts` warning about the blocked `prepare` script on install is benign:
the tarball ships `.output` prebuilt.

## Hard constraints — do NOT regress these

- **Never spawn via `eve start`.** The launcher (`bin/eve-coder.mjs`) must spawn
  `.output/server/index.mjs` directly. `eve start` prewarms sandboxes by
  reloading agent modules from the build machine's absolute source paths, which
  crash on any other machine (`Failed to resolve the authored package root`).
- **Never pass `PORT=0`.** The workflow queue derives its callback URL from
  `process.env.PORT`; port 0 makes every queue delivery fetch
  `http://localhost:0` and session creation fails with `HookNotFoundError`
  ("Failed to create the session" in the TUI). Probe a real free port
  (`findFreePort()` in the launcher) and pass it as `PORT`/`NITRO_PORT`.
- **Server cwd must be writable.** The server writes its workflow store at
  `cwd/.eve/.workflow-data`, so the launcher runs it from
  `~/.local/state/eve-coder/` — never from the (root-owned) package dir.
- **Never use `npm i -g github:amanmprojects/eve-coder`.** npm 11's git-dep
  preparation for *global* installs installs dependencies into the global
  prefix instead of the clone, so `prepare` can't find the `eve` CLI — and the
  failed install wipes the existing package. Use the release tarball URL.
- **`npm pack` needs no login** — it is the publish mechanism.

## Diagnostics

- Server log: `~/.local/state/eve-coder/server.log` — port + errors land here.
- Workflow store: `~/.local/state/eve-coder/.eve/.workflow-data`. If sessions
  get stuck, `rm -rf ~/.local/state/eve-coder/.eve` clears stale runs (safe;
  the launcher recreates it).
- `AI_GATEWAY_API_KEY` comes from the shell env, or `~/.config/eve-coder/env` /
  `~/.eve-coder.env` (the launcher loads those). Check gateway status:
  `curl http://127.0.0.1:<port>/eve/v1/info` → `model.endpoint.connected`.
