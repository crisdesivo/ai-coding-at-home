#!/usr/bin/env node
// Vendors the pi packages that guard the local agent into resources/safeguards/, where
// electron-builder copies them (extraResources) and main.ts lists them in pi's settings
// `packages`, cc-safety-net first. Run it again after bumping a version:
//   node scripts/vendor-safeguards.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const safeguardsDir = join(desktopDir, "resources", "safeguards");
const patchesDir = resolve(desktopDir, "patches");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const PACKAGES = [
  { dir: "cc-safety-net", spec: "cc-safety-net@2.7.12" },
  {
    dir: "pix-gate",
    spec: "@xynogen/pix-gate@0.4.11",
    // Applied in this order with `patch -p3` (the patches are rooted at pix-mono's checkout).
    patches: ["pix-gate-no-timeout.patch", "pix-gate-host-fallback.patch"],
    installDependencies: true,
  },
];

function run(command, args, cwd, input) {
  execFileSync(command, args, {
    cwd,
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    ...(input === undefined ? {} : { input }),
    shell: process.platform === "win32",
  });
}

function vendor({ dir, spec, patches = [], installDependencies = false }) {
  const target = join(safeguardsDir, dir);
  const scratch = mkdtempSync(join(tmpdir(), "pi-at-home-safeguard-"));
  try {
    run(npm, ["pack", spec, "--silent", "--pack-destination", scratch], scratch);
    const tarball = readdirSync(scratch).find((name) => name.endsWith(".tgz"));
    if (!tarball) {
      throw new Error(`npm pack ${spec} produced no tarball`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    // Extract inside the target with no paths on the command line: on Windows, Git's GNU tar
    // reads a "C:" archive path as a remote host and mangles a Windows path given to -C.
    copyFileSync(join(scratch, tarball), join(target, tarball));
    run("tar", ["-xzf", tarball, "--strip-components=1"], target);
    rmSync(join(target, tarball));

    for (const name of patches) {
      // patch(1) reads the leading `#` lines as garbage, so strip them first.
      const body = readFileSync(join(patchesDir, name), "utf8")
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .join("\n");
      run("patch", ["-p3", "--forward", "--batch"], target, body);
    }

    if (installDependencies) {
      run(
        npm,
        [
          "install",
          "--omit=dev",
          "--omit=peer",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
        ],
        target,
      );
    }
    console.log(`[vendor-safeguards] ${spec} -> ${target}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

mkdirSync(safeguardsDir, { recursive: true });
for (const entry of PACKAGES) {
  vendor(entry);
}
