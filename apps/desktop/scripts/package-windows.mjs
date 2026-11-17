import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runElectronBuilder } from "./run-electron-builder.mjs";

const electronBuilderArgs = process.argv.slice(2);
if (electronBuilderArgs.length === 0) {
  throw new Error("Usage: package-windows.mjs <electron-builder args...>");
}

// Building on Linux (or macOS): electron-builder edits the exe's icon and version with rcedit under Wine, and
// picks the 32-bit rcedit, which needs wine32 (often not installed). Point it at the 64-bit rcedit
// under both names, and keep Wine's state in its own prefix instead of the user's ~/.wine.
const RCEDIT = {
  url: "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe",
  sha256: "3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a",
};

async function prepareWineTools() {
  const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const toolsDir = path.join(repoDir, ".cache", "tools", "rcedit-2.0.0");
  const x64 = path.join(toolsDir, "rcedit-x64.exe");
  if (!existsSync(x64)) {
    const response = await fetch(RCEDIT.url);
    if (!response.ok) throw new Error(`could not download rcedit: HTTP ${response.status}`);
    const binary = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(binary).digest("hex");
    if (actual !== RCEDIT.sha256) throw new Error(`rcedit sha256 mismatch: ${actual}`);
    mkdirSync(toolsDir, { recursive: true });
    writeFileSync(x64, binary);
  }
  copyFileSync(x64, path.join(toolsDir, "rcedit-x86.exe"));
  process.env.ELECTRON_BUILDER_RCEDIT_PATH ??= toolsDir;
  process.env.WINEPREFIX ??= path.join(repoDir, ".cache", "wine64");
  process.env.WINEARCH ??= "win64";
  process.env.WINEDEBUG ??= "-all";
  // And extract the NSIS uninstaller without running the 32-bit stub (see the hook's comment).
  const hook = fileURLToPath(new URL("./nsis-uninstaller-without-wine32.cjs", import.meta.url));
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require=${JSON.stringify(hook)}`]
    .filter(Boolean)
    .join(" ");
}

if (process.platform !== "win32") await prepareWineTools();

process.exit(await runElectronBuilder(electronBuilderArgs));
