# Desktop Test Guidelines

Apply these rules under `apps/desktop/tests/`.

- Use the lane scripts in `apps/desktop/package.json` before inventing ad hoc Playwright commands.
- Pick the smallest lane that matches the changed surface:
- `unit`: Node-level logic (engine choice, downloads, storage, Git contracts) without launching
  Electron. Part of `pnpm check`.
- `core`: credential-free Electron UI and local runtime integration with fixtures, scripted
  OpenAI-compatible servers and injected events. CI runs it in four Linux (Xvfb) shards with two
  workers each; local Linux background runs use three workers (`PI_APP_TEST_WORKERS` overrides).
  Workers on one display share its clipboard, so run a clipboard failure alone before calling it
  a regression.
- `live`: real conversations against a running llama.cpp server. `test:e2e:live` sets
  `PI_APP_LIVE=1`; `PI_APP_LIVE_MODEL_URL` and `PI_APP_LIVE_MODEL_ID` name the server and model.
- `native`: macOS OS-surface flows (real clipboard paste, folder picker, notifications). These
  are foreground-only and focus-sensitive.
- `production`: opt-in packaged macOS app smokes. Keep them out of the `core` and `native` globs.
- `dev`, `perf`: the dev-reload check and on-demand profiling specs.
- Prefer shared helpers in `tests/helpers/electron-app.ts`; extend them instead of adding a second
  harness or new IPC glue.
- Simulate user behavior through Playwright first. Do not add IPC/state shortcuts for visible
  behavior unless the product surface does not exist yet; if you need one, document the gap.
- `pasteTinyPng()` proves the renderer paste handler and suits background/core coverage.
  `pasteTinyPngViaClipboard()` proves real Electron clipboard paste and belongs in native coverage.

## Flaky tests

- A flake is a bug in the test or the product. Never retry, skip, quarantine or raise a timeout to get green: find the race, fix it, and say what it was.
- Wait on the app's real state, not on what happens to be visible. Content that paints before an async step settles (an extension frame before it reports ready, a row before a pin round-trip moves it) is not readiness. When no observable state exists, expose one on the surface (for example `data-state` on `extension-view-panel`) and wait on it with a shared helper.
- Before clicking inside the transcript right after a thread switch, side-panel toggle or resize, call `waitForTimelineLayout`. Timeline rows move once measured, and a click whose press and release straddle that move is silently lost, so Playwright's own stability check is not enough.
- Do not race product calls against wall-clock deadlines. Assert the behavior (a call returned while its work is still pending) against a fixture that makes the alternative impossible.
- If a flaky test checks nothing a user would notice, propose rewriting or removing it rather than keeping it green.
