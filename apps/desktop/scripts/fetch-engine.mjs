#!/usr/bin/env node
// Puts the pinned official llama.cpp build (the local AI engine) into resources/engine/<platform>/,
// where electron-builder copies it (extraResources, current platform only).
//
//   node scripts/fetch-engine.mjs <linux|win|mac>   download, verify sha256, extract, prune
//   node scripts/fetch-engine.mjs --pin [<tag>]      rewrite resources/engine/engine-pin.json for a
//                                                   release (default: the newest bNNNNN release)
//
// engine-pin.json is the only source file here; the platform folders are generated (gitignored).
// The engine manager (electron/engine/) reads the same pin to download the CUDA build on first run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(desktopDir, "..", "..");
const engineDir = join(desktopDir, "resources", "engine");
const pinPath = join(engineDir, "engine-pin.json");
const cacheDir = process.env.PI_AT_HOME_ENGINE_CACHE ?? join(repoDir, ".cache", "engine");
const REPO = "ggml-org/llama.cpp";

// Asset key -> file name in a release. The vulkan/mac builds are bundled; the CUDA ones are
// downloaded by the app on first run when an NVIDIA GPU is present.
const ASSET_NAMES = {
  "linux-vulkan-x64": (tag) => `llama-${tag}-bin-ubuntu-vulkan-x64.tar.gz`,
  "win-vulkan-x64": (tag) => `llama-${tag}-bin-win-vulkan-x64.zip`,
  "mac-arm64": (tag) => `llama-${tag}-bin-macos-arm64.tar.gz`,
  "linux-cuda-x64": (tag) => `llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  "linux-cudart-x64": (tag) => `cudart-llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  "win-cuda-x64": (tag) => `llama-${tag}-bin-win-cuda-12.4-x64.zip`,
  "win-cudart-x64": () => "cudart-llama-bin-win-cuda-12.4-x64.zip",
};

const PLATFORMS = {
  linux: { key: "linux-vulkan-x64", server: "llama-server" },
  win: { key: "win-vulkan-x64", server: "llama-server.exe" },
  mac: { key: "mac-arm64", server: "llama-server" },
};

// Libraries that only back the other llama.cpp tools (llama-server needs llama-server-impl).
const OTHER_TOOL_IMPL = /(^|lib)llama-(?!server-impl)[a-z-]+-impl\.(so|dll|dylib)$/;

function fail(message) {
  console.error(`fetch-engine: ${message}`);
  process.exit(1);
}

async function githubJson(path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "fetch-engine" };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers });
  if (!response.ok) fail(`GitHub API ${path}: HTTP ${response.status}`);
  return response.json();
}

async function writePin(tagArg) {
  let release;
  if (tagArg) {
    release = await githubJson(`releases/tags/${tagArg}`);
  } else {
    const releases = await githubJson("releases?per_page=20");
    release = releases.find((r) => /^b\d+$/.test(r.tag_name) && !r.draft);
    if (!release) fail("no bNNNNN release found");
  }
  const tag = release.tag_name;
  const byName = new Map(release.assets.map((a) => [a.name, a]));
  const assets = {};
  for (const [key, nameOf] of Object.entries(ASSET_NAMES)) {
    const asset = byName.get(nameOf(tag));
    if (!asset) fail(`release ${tag} has no asset ${nameOf(tag)}`);
    let sha256 =
      typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
        ? asset.digest.slice("sha256:".length)
        : null;
    if (!sha256) {
      console.log(`no digest for ${asset.name}; downloading to compute it`);
      sha256 = await sha256File(await download(asset.browser_download_url, asset.name, null));
    }
    assets[key] = { name: asset.name, url: asset.browser_download_url, sha256, size: asset.size };
  }
  mkdirSync(engineDir, { recursive: true });
  writeFileSync(pinPath, `${JSON.stringify({ tag, assets }, null, 2)}\n`);
  console.log(`pinned llama.cpp ${tag} in ${pinPath}`);
}

function sha256File(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function download(url, name, expectedSha256) {
  mkdirSync(cacheDir, { recursive: true });
  const target = join(cacheDir, name);
  if (expectedSha256 && existsSync(target) && (await sha256File(target)) === expectedSha256) {
    console.log(`using cached ${target}`);
    return target;
  }
  console.log(`downloading ${url}`);
  const partial = `${target}.part`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
      renameSync(partial, target);
      return target;
    } catch (error) {
      lastError = error;
      console.error(`download attempt ${attempt} failed: ${error.message}`);
    }
  }
  fail(`could not download ${url}: ${lastError?.message}`);
}

function extract(archive, into) {
  if (archive.endsWith(".zip")) {
    // Windows 10+ ships bsdtar, which reads zip; elsewhere use unzip (bsdtar on macOS works too).
    if (process.platform === "win32") execFileSync("tar", ["-xf", archive, "-C", into]);
    else execFileSync("unzip", ["-q", archive, "-d", into]);
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", into]);
  }
}

// The release puts its files at the top level (zip) or in one llama-<tag>/ folder (tar.gz).
function findServerDir(root, server) {
  if (existsSync(join(root, server))) return root;
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry);
    if (statSync(candidate).isDirectory() && existsSync(join(candidate, server))) return candidate;
  }
  fail(`${server} not found in the archive`);
}

// Turn the library symlink chains into plain files named by their soname (libggml.so.1,
// libggml.1.dylib: the names the binaries load), so the packaged folder has no symlinks.
function flattenSymlinks(dir) {
  const isSoname = (name) => /\.so\.\d+$/.test(name) || /^[^.]+\.\d+\.dylib$/.test(name);
  const entries = readdirSync(dir);
  const links = entries.filter((name) => lstatSync(join(dir, name)).isSymbolicLink());
  const sonames = new Map(
    links.filter(isSoname).map((name) => [name, realpathSync(join(dir, name))]),
  );
  const targets = new Set(sonames.values());
  for (const name of links) rmSync(join(dir, name));
  for (const [name, real] of sonames) copyFileSync(real, join(dir, name));
  for (const real of targets) rmSync(real, { force: true });
}

function keep(name, server) {
  if (name === server) return true;
  if (/^LICENSE/.test(name)) return true;
  if (OTHER_TOOL_IMPL.test(name)) return false;
  return /\.(so(\.\d+)*|dll|dylib)$/.test(name);
}

async function fetchPlatform(platform) {
  const spec = PLATFORMS[platform];
  if (!spec) fail(`usage: fetch-engine.mjs <${Object.keys(PLATFORMS).join("|")}> | --pin [tag]`);
  if (!existsSync(pinPath)) fail(`missing ${pinPath}; run with --pin first`);
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  const asset = pin.assets[spec.key];
  if (!asset) fail(`engine-pin.json has no "${spec.key}" asset`);

  const outDir = join(engineDir, platform);
  const markerPath = join(outDir, "engine.json");
  const marker = { tag: pin.tag, platform, asset: asset.name, sha256: asset.sha256 };
  if (
    existsSync(markerPath) &&
    readFileSync(markerPath, "utf8") === `${JSON.stringify(marker, null, 2)}\n`
  ) {
    console.log(`engine ${pin.tag} for ${platform} already in ${outDir}`);
    return;
  }

  const archive = await download(asset.url, asset.name, asset.sha256);
  const actual = await sha256File(archive);
  if (actual !== asset.sha256) {
    rmSync(archive, { force: true });
    fail(`sha256 mismatch for ${asset.name}: expected ${asset.sha256}, got ${actual}`);
  }

  const scratch = mkdtempSync(join(cacheDir, "extract-"));
  try {
    extract(archive, scratch);
    const srcDir = findServerDir(scratch, spec.server);
    flattenSymlinks(srcDir);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const name of readdirSync(srcDir)) {
      if (!keep(name, spec.server)) continue;
      copyFileSync(join(srcDir, name), join(outDir, name));
    }
    if (!existsSync(join(outDir, "LICENSE"))) {
      // The Windows zips ship without llama.cpp's MIT notice; take it from the tagged source.
      const license = await download(
        `https://raw.githubusercontent.com/${REPO}/${pin.tag}/LICENSE`,
        `LICENSE-llama.cpp-${pin.tag}`,
        null,
      );
      copyFileSync(license, join(outDir, "LICENSE"));
    }
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const kept = readdirSync(outDir);
  console.log(`engine ${pin.tag} for ${platform}: ${kept.length} files in ${outDir}`);
}

const [arg, tagArg] = process.argv.slice(2);
if (arg === "--pin") await writePin(tagArg);
else await fetchPlatform(arg);
