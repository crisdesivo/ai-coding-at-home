#!/usr/bin/env node
// Builds the macOS (Apple chips) zip, from Linux or a Mac, with no Apple account:
//   1. electron-builder --mac dir --arm64 (electron-builder cannot sign on Linux, so it leaves the app unsigned)
//   2. check every Mach-O inside the .app is arm64 (an x64-only binary would not run)
//   3. ad-hoc sign the whole .app with rcodesign (Apple chips refuse binaries with a broken signature)
//   4. verify every signature (see verifyMachOSignature), then zip it keeping symlinks (the frameworks need them), like `ditto -c -k`
//
// rcodesign: $RCODESIGN, else `rcodesign` on PATH, else the pinned release downloaded (sha256
// checked) into <repo>/.cache/tools/. On a Mac without rcodesign, `codesign -s -` is used instead.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runElectronBuilder } from "./run-electron-builder.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(desktopDir, "..", "..");
const releaseDir = path.join(desktopDir, "release");
const appDir = path.join(releaseDir, "mac-arm64", "AI Coding at Home.app");
const { version } = JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8"));
const zipPath = path.join(releaseDir, `AI-Coding-at-Home-${version}-arm64-mac.zip`);

const RCODESIGN = {
  version: "0.29.0",
  url: "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz",
  sha256: "dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002",
};

function fail(message) {
  console.error(`package-mac: ${message}`);
  process.exit(1);
}

function onPath(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

async function resolveRcodesign() {
  if (process.env.RCODESIGN) return process.env.RCODESIGN;
  if (onPath("rcodesign")) return "rcodesign";
  if (process.platform === "darwin") return null; // codesign below
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("set RCODESIGN to an rcodesign binary (https://github.com/indygreg/apple-platform-rs)");
  }
  const toolsDir = path.join(repoDir, ".cache", "tools");
  const binary = path.join(toolsDir, `rcodesign-${RCODESIGN.version}`);
  if (existsSync(binary)) return binary;
  console.log(`downloading rcodesign ${RCODESIGN.version}`);
  const response = await fetch(RCODESIGN.url);
  if (!response.ok) fail(`could not download rcodesign: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== RCODESIGN.sha256) fail(`rcodesign sha256 mismatch: ${actual}`);
  mkdirSync(toolsDir, { recursive: true });
  const scratch = mkdtempSync(path.join(toolsDir, "rcodesign-"));
  try {
    writeFileSync(path.join(scratch, "rcodesign.tar.gz"), archive);
    execFileSync("tar", ["-xzf", "rcodesign.tar.gz", "--strip-components=1"], { cwd: scratch });
    renameSync(path.join(scratch, "rcodesign"), binary);
    chmodSync(binary, 0o755);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return binary;
}

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const CPU_TYPE_ARM64 = 0x0100000c;

// Returns null for non-Mach-O files, else the list of CPU types it contains.
function machOCpuTypes(file) {
  const fd = openSync(file, "r");
  try {
    const header = Buffer.alloc(8 + 20 * 8);
    const read = readSync(fd, header, 0, header.length, 0);
    if (read < 8) return null;
    if (header.readUInt32LE(0) === MH_MAGIC_64) return [header.readUInt32LE(4)];
    if (header.readUInt32BE(0) === FAT_MAGIC) {
      const count = header.readUInt32BE(4);
      // Java class files share the magic; a real fat header has few architectures.
      if (count === 0 || count > 20) return null;
      return Array.from({ length: count }, (_, i) => header.readUInt32BE(8 + i * 20));
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

const MH_EXECUTE = 2;

function isMachOExecutable(file) {
  const fd = openSync(file, "r");
  try {
    const header = Buffer.alloc(16);
    readSync(fd, header, 0, 16, 0);
    return header.readUInt32LE(0) === MH_MAGIC_64 && header.readUInt32LE(12) === MH_EXECUTE;
  } finally {
    closeSync(fd);
  }
}

// Checks every Mach-O in the app contains arm64 and returns their paths.
function checkArchitectures(dir) {
  const notArm64 = [];
  const machOs = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) {
        const types = machOCpuTypes(full);
        if (!types) continue;
        machOs.push(full);
        if (!types.includes(CPU_TYPE_ARM64)) notArm64.push(path.relative(dir, full));
        // npm tarballs can drop the exec bit (node-pty's spawn-helper prebuild has none; its
        // postinstall restores it only when installed on a Mac). An executable must keep it.
        if (isMachOExecutable(full) && (stat.mode & 0o111) === 0) {
          chmodSync(full, 0o755);
          console.log(`made executable: ${path.relative(dir, full)}`);
        }
      }
    }
  };
  walk(dir);
  if (notArm64.length > 0) fail(`Mach-O files without arm64:\n  ${notArm64.join("\n  ")}`);
  console.log(`all ${machOs.length} Mach-O files in the app contain arm64`);
  return machOs;
}

// `rcodesign verify` rejects every ad-hoc signature ("CMS error": an ad-hoc signature has an empty
// CMS blob, exactly like `codesign -s -` makes) and is documented as unreliable, so the signature is
// checked here the way the macOS kernel and codesign do: every code page hash in the CodeDirectory,
// the bound Info.plist / requirements / CodeResources hashes, and each sealed resource file.
const LC_CODE_SIGNATURE = 0x1d;
const sha256 = (data) => createHash("sha256").update(data).digest();

function readCodeSignature(file) {
  const data = readFileSync(file);
  // Fat files: check the arm64 slice (the only one the app needs).
  let base = 0;
  if (data.readUInt32BE(0) === FAT_MAGIC) {
    const count = data.readUInt32BE(4);
    const slice = Array.from({ length: count }, (_, i) => 8 + i * 20).find(
      (at) => data.readUInt32BE(at) === CPU_TYPE_ARM64,
    );
    base = data.readUInt32BE(slice + 8);
  }
  const ncmds = data.readUInt32LE(base + 16);
  let at = base + 32;
  let signature;
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = data.readUInt32LE(at);
    if (cmd === LC_CODE_SIGNATURE) {
      signature = { offset: base + data.readUInt32LE(at + 8), size: data.readUInt32LE(at + 12) };
    }
    at += data.readUInt32LE(at + 4);
  }
  if (!signature) return { data, base, blobs: null };
  const superBlob = data.subarray(signature.offset, signature.offset + signature.size);
  if (superBlob.readUInt32BE(0) !== 0xfade0cc0) return { data, base, blobs: null };
  const blobs = new Map();
  for (let i = 0; i < superBlob.readUInt32BE(8); i += 1) {
    const type = superBlob.readUInt32BE(12 + i * 8);
    const offset = superBlob.readUInt32BE(16 + i * 8);
    blobs.set(type, superBlob.subarray(offset, offset + superBlob.readUInt32BE(offset + 4)));
  }
  return { data, base, blobs };
}

// Returns the CodeDirectory's cdhash (first 20 bytes of its sha256), failing on any mismatch.
function verifyMachOSignature(file) {
  const { data, base, blobs } = readCodeSignature(file);
  const where = path.relative(appDir, file);
  const cd = blobs?.get(0);
  if (!cd || cd.readUInt32BE(0) !== 0xfade0c02) fail(`${where} is not signed`);
  const hashOffset = cd.readUInt32BE(16);
  const nSpecialSlots = cd.readUInt32BE(24);
  const nCodeSlots = cd.readUInt32BE(28);
  const codeLimit = cd.readUInt32BE(32);
  const hashSize = cd.readUInt8(36);
  const hashType = cd.readUInt8(37);
  const pageSize = 2 ** cd.readUInt8(39);
  if (hashType !== 2 || hashSize !== 32) fail(`${where}: unexpected hash type ${hashType}`);
  for (let i = 0; i < nCodeSlots; i += 1) {
    const start = base + i * pageSize;
    const page = data.subarray(start, Math.min(start + pageSize, base + codeLimit));
    const expected = cd.subarray(hashOffset + i * 32, hashOffset + (i + 1) * 32);
    if (!sha256(page).equals(expected))
      fail(`${where}: code page ${i} does not match its signature`);
  }
  const special = (slot) =>
    slot <= nSpecialSlots
      ? cd.subarray(hashOffset - slot * 32, hashOffset - (slot - 1) * 32)
      : null;
  const isZero = (hash) => !hash || hash.every((byte) => byte === 0);
  // Slot 2: requirements; slot 5: entitlements (both are blobs in the same signature).
  for (const [slot, blobType] of [
    [2, 2],
    [5, 5],
  ]) {
    const hash = special(slot);
    if (isZero(hash)) continue;
    const blob = blobs.get(blobType);
    if (!blob || !sha256(blob).equals(hash)) fail(`${where}: special slot ${slot} does not match`);
  }
  // Slots 1 and 3: the bundle's Info.plist and CodeResources, for a bundle's main executable.
  const infoHash = special(1);
  const resourcesHash = special(3);
  if (!isZero(infoHash) || !isZero(resourcesHash)) {
    const app = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(file);
    const framework = /^(.*\.framework\/Versions\/[^/]+)\/[^/]+$/.exec(file);
    const contents = app ? path.join(app[1], "Contents") : framework?.[1];
    if (!contents) fail(`${where}: binds an Info.plist but is not a bundle executable`);
    const infoPlist = path.join(
      contents,
      app ? "Info.plist" : path.join("Resources", "Info.plist"),
    );
    const codeResources = path.join(contents, "_CodeSignature", "CodeResources");
    if (!isZero(infoHash) && !sha256(readFileSync(infoPlist)).equals(infoHash)) {
      fail(`${where}: Info.plist does not match its signature`);
    }
    if (!isZero(resourcesHash)) {
      if (!sha256(readFileSync(codeResources)).equals(resourcesHash)) {
        fail(`${where}: CodeResources does not match its signature`);
      }
      verifySealedResources(contents, codeResources);
    }
  }
  return sha256(cd).subarray(0, 20);
}

let sealedFilesChecked = 0;

// Checks each file sealed in CodeResources (files2): plain files by sha256, nested bundles by cdhash.
function verifySealedResources(contents, codeResources) {
  const plist = readFileSync(codeResources, "utf8");
  // Entries start after files2's own opening <dict>.
  const start = plist.indexOf("<dict>", plist.indexOf("<key>files2</key>")) + "<dict>".length;
  const end = plist.indexOf("<key>rules</key>", start);
  const files2 = plist.slice(start, end === -1 ? undefined : end);
  const entry = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  const unescape = (text) =>
    text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
  for (const [, rawName, body] of files2.matchAll(entry)) {
    const name = unescape(rawName);
    const target = path.join(contents, name);
    const hash2 = /<key>hash2<\/key>\s*<data>\s*([^<\s]+)\s*<\/data>/.exec(body);
    const cdhash = /<key>cdhash<\/key>\s*<data>\s*([^<\s]+)\s*<\/data>/.exec(body);
    if (hash2) {
      if (!sha256(readFileSync(target)).equals(Buffer.from(hash2[1], "base64"))) {
        fail(
          `${path.relative(appDir, target)} does not match the seal in ${path.relative(appDir, codeResources)}`,
        );
      }
    } else if (cdhash) {
      const nestedMain = nestedMainExecutable(target);
      if (!verifyMachOSignature(nestedMain).equals(Buffer.from(cdhash[1], "base64"))) {
        fail(
          `${path.relative(appDir, target)} does not match the seal in ${path.relative(appDir, codeResources)}`,
        );
      }
    } else {
      continue;
    }
    sealedFilesChecked += 1;
  }
}

function nestedMainExecutable(target) {
  if (target.endsWith(".app")) {
    const info = readFileSync(path.join(target, "Contents", "Info.plist"), "utf8");
    const name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(info)[1];
    return path.join(target, "Contents", "MacOS", name);
  }
  if (target.endsWith(".framework")) {
    const name = path.basename(target, ".framework");
    return realpathSync(path.join(target, name));
  }
  // A sealed Mach-O outside a bundle (e.g. a helper tool): its own signature.
  return target;
}

// --verify-only: check the already built and signed app (no build, no signing, no zip).
const verifyOnly = process.argv.includes("--verify-only");
if (verifyOnly) {
  for (const file of checkArchitectures(appDir)) verifyMachOSignature(file);
  console.log(`ad-hoc signatures valid; ${sealedFilesChecked} sealed files checked`);
  process.exit(0);
}
const extraArgs = process.argv.slice(2);
rmSync(path.join(releaseDir, "mac-arm64"), { recursive: true, force: true });
const status = await runElectronBuilder([
  "--mac",
  "dir",
  "--arm64",
  "--publish",
  "never",
  "--config.npmRebuild=false",
  ...extraArgs,
]);
if (status !== 0) process.exit(status);
if (!existsSync(appDir)) fail(`electron-builder did not produce ${appDir}`);

const machOs = checkArchitectures(appDir);

const rcodesign = await resolveRcodesign();
if (rcodesign) {
  execFileSync(rcodesign, ["sign", appDir], { stdio: "inherit" });
  for (const file of machOs) verifyMachOSignature(file);
  console.log(
    `ad-hoc signatures valid: ${machOs.length} Mach-O files, ${sealedFilesChecked} sealed files checked`,
  );
} else {
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appDir], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appDir], { stdio: "inherit" });
}

rmSync(zipPath, { force: true });
// -y keeps symlinks as symlinks (the .framework layout depends on them), -X drops extra attributes.
execFileSync("zip", ["-q", "-r", "-y", "-X", zipPath, path.basename(appDir)], {
  cwd: path.dirname(appDir),
  stdio: "inherit",
});
console.log(`macOS zip: ${zipPath}`);
