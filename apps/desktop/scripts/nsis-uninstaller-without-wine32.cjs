// Preloaded into electron-builder (NODE_OPTIONS=--require) by package-windows.mjs on Linux.
//
// To embed the uninstaller, electron-builder first builds a throwaway installer and runs it,
// which writes the uninstaller out. The NSIS stub is 32-bit, so on Linux that run needs wine32,
// often not installed. On macOS electron-builder instead extracts the uninstaller from that
// installer in plain JavaScript (UninstallerReader); its only switch is isMacOsCatalina(), which
// nothing else reads. Turning it on makes Linux use the same extraction, so no Wine is involved.
"use strict";

try {
  const macosVersionPath = require.resolve("app-builder-lib/out/util/macosVersion", {
    paths: [process.cwd(), __dirname],
  });
  const macosVersion = require(macosVersionPath);
  macosVersion.isMacOsCatalina = () => true;
} catch {
  // Not the electron-builder process (pnpm itself also gets NODE_OPTIONS): nothing to patch.
}
