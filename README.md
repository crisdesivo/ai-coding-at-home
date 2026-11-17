# AI Coding at Home

A free coding assistant that runs entirely on your own computer. No account, no subscription,
no cloud: your code never leaves your machine.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#install)

On first launch the app checks your computer, picks the best AI model it can run well, downloads
it and starts it. After that you open a project folder and ask it to write, fix or explain code.
It edits files and runs commands for you, and asks before doing anything risky.

> **Preview.** This is an early release. Please report problems in
> [Issues](https://github.com/crisdesivo/ai-coding-at-home/issues).

## Install

Download from the [latest release](https://github.com/crisdesivo/ai-coding-at-home/releases/latest).

- **Windows (x64):** run `AI-Coding-at-Home-x64-setup.exe`. It installs for your user only, no
  admin needed. The app isn't code-signed, so Windows SmartScreen may warn you: click
  **More info → Run anyway**.
- **macOS (Apple chips, M1 or newer):** open Terminal and paste:
  ```
  curl -fsSL https://github.com/crisdesivo/ai-coding-at-home/releases/latest/download/install-mac.sh | bash
  ```
  It installs the app into Applications and opens it. Intel Macs aren't supported.
- **Linux (x64):** download the `.AppImage`, make it executable and run it, or install the `.deb`.

### What the first launch needs

- **Disk:** the model download is 1–25 GB depending on your computer (at least 2 GB is always
  left free).
- **Memory:** a graphics card with 4 GB or more, or an Apple chip, works best. Computers without
  a graphics card need plenty of RAM, and replies are slower.
- **Internet:** only for the first download. After that everything runs offline.

## How it works

- **The engine** is [llama.cpp](https://github.com/ggml-org/llama.cpp) (Vulkan on Windows and
  Linux, Metal on Mac; NVIDIA cards on Windows also get the faster CUDA build).
- **The model** is chosen from a hand-picked list of open models (Apache-2.0 / MIT licensed),
  sized so it fits your graphics card and memory with room for a 100,000-token conversation.
- **The assistant** is the [pi](https://github.com/earendil-works/pi) coding agent, locked to
  that one local model.
- **Safeguards:** dangerous commands are blocked ([cc-safety-net](https://github.com/kenryu42/cc-safety-net))
  and risky ones wait for your approval ([pix-gate](https://www.npmjs.com/package/@xynogen/pix-gate)).
  Nothing is approved automatically.

## Development

Requires Node 22.19 or newer and [pnpm](https://pnpm.io) through `corepack`.

```
corepack pnpm install
cd apps/desktop
corepack pnpm run vendor:safeguards   # fetches and patches the safeguard extensions
corepack pnpm run dev
```

In development the app sets up its own engine and model like a fresh install. To use a
llama-server you started yourself instead, point `PI_AT_HOME_MODEL_CONFIG` at a JSON file like
`{"baseUrl": "http://127.0.0.1:8080/v1", "modelId": "my-model", "name": "My model", "contextWindow": 102400}`.

Packaging (all three can be built from Linux; Windows needs Wine):

```
corepack pnpm run package:linux   # AppImage + .deb
corepack pnpm run package:win     # NSIS installer
corepack pnpm run package:mac     # zip, ad-hoc signed with rcodesign
```

## Credits

AI Coding at Home brings together several open-source projects, all MIT licensed:

- [llama.cpp](https://github.com/ggml-org/llama.cpp), the engine that runs the model
- [pi](https://github.com/earendil-works/pi), the coding agent
- [pi-gui](https://github.com/minghinmatthewlam/pi-gui) by Matthew Lam, the base of the desktop window
- [cc-safety-net](https://github.com/kenryu42/cc-safety-net) and [pix-gate](https://www.npmjs.com/package/@xynogen/pix-gate), the command safeguards

## License

[MIT](./LICENSE). © 2026 Cristian Desivo. Includes code from pi-gui, © 2026 Matthew Lam.
