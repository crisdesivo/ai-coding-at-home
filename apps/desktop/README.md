# Desktop App

The Electron app: the main process with the engine manager and setup window, the React renderer,
and their Playwright tests. See the [root README](../../README.md) for setup and packaging.

## Development

```bash
corepack pnpm install
corepack pnpm --dir apps/desktop run vendor:safeguards
corepack pnpm --dir apps/desktop dev        # electron-vite with hot reload
corepack pnpm --dir apps/desktop build      # shared packages + app bundles in out/
```

`dev` rebuilds the shared workspace packages up front and keeps them in watch mode. Set
`PI_APP_USER_DATA_DIR` to run with an isolated profile.

## Packaging

```bash
corepack pnpm --dir apps/desktop run package:linux       # AppImage + .deb
corepack pnpm --dir apps/desktop run package:linux:dir   # unpacked, faster
corepack pnpm --dir apps/desktop run package:win         # NSIS installer (Wine on Linux)
corepack pnpm --dir apps/desktop run package:mac         # zip, ad-hoc signed with rcodesign
corepack pnpm --dir apps/desktop run verify:packaged-runtime-deps:linux
```

Each packaging script first fetches the pinned llama.cpp engine for its platform
(`scripts/fetch-engine.mjs`, pin in `resources/engine/engine-pin.json`).
`verify:packaged-runtime-deps*` checks that the packaged `app.asar` carries pi's runtime
dependencies, node-pty and the bundled engine.

`package:win*` routes through `scripts/package-windows.mjs`. On Linux it fetches a 64-bit rcedit
and extracts the NSIS uninstaller without 32-bit Wine. On Windows it prefers the ASCII repo-local
`tools/pnpm.cmd` shim and keeps `ELECTRON_BUILDER_CACHE` under `.cache/`. Packaging retries
GitHub 502/503/504 downloads of Electron and electron-builder binaries up to three times.

## Test lanes

Use the smallest lane that matches the changed surface (see [tests/AGENTS.md](tests/AGENTS.md)).

```bash
corepack pnpm test:desktop-unit                          # from the repo root; Node-only unit specs
corepack pnpm --dir apps/desktop run test:e2e:core       # Electron UI, fixtures, no real model
corepack pnpm --dir apps/desktop run test:e2e:live       # real llama.cpp server (PI_APP_LIVE_MODEL_URL/ID)
corepack pnpm --dir apps/desktop run test:e2e:native     # macOS, foreground
corepack pnpm --dir apps/desktop run test:dev:reload     # dev-mode reload wiring
```

Run one core spec while iterating, for example `test:core:persistence`, or any spec with
`test:e2e:runner -- apps/desktop/tests/core/<spec>.spec.ts`. On Linux, run Electron specs under
`xvfb-run` when there is no display.

`tests/production` holds opt-in packaged macOS smokes (`test:prod:*`); they need a Mac.
