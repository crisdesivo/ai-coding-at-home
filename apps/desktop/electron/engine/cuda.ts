import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import enginePinJson from "../../resources/engine/engine-pin.json";
import { formatBytes } from "./catalog";
import {
  DEFAULT_HEADROOM_BYTES,
  downloadFile,
  freeDiskBytes,
  type DownloadProgress,
} from "./download";
import { listEngineDevices, parseListDevices } from "./detect";
import { findServerBinary } from "./locate";

/**
 * The official CUDA build of the same llama.cpp release, for NVIDIA cards on Windows and Linux.
 * The installer bundles the Vulkan build (works on every GPU); the CUDA one is usually faster on
 * NVIDIA and is downloaded in the background after the first setup, then used from the next launch.
 */
export interface EnginePinAsset {
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

export interface EnginePin {
  readonly tag: string;
  readonly assets: Readonly<Record<string, EnginePinAsset>>;
}

export const ENGINE_PIN: EnginePin = enginePinJson as EnginePin;

export interface CudaPlan {
  /** The CUDA llama.cpp build. */
  readonly engine: EnginePinAsset;
  /** NVIDIA's runtime libraries; always needed on Windows, on Linux only without a CUDA toolkit. */
  readonly runtime?: EnginePinAsset;
  readonly runtimeAlways: boolean;
}

export function cudaPlan(
  pin: EnginePin,
  platform: NodeJS.Platform,
  arch: string,
): CudaPlan | undefined {
  if (arch !== "x64") return undefined;
  if (platform === "win32") {
    const engine = pin.assets["win-cuda-x64"];
    const runtime = pin.assets["win-cudart-x64"];
    return engine && runtime ? { engine, runtime, runtimeAlways: true } : undefined;
  }
  if (platform === "linux") {
    const engine = pin.assets["linux-cuda-x64"];
    const runtime = pin.assets["linux-cudart-x64"];
    return engine ? { engine, ...(runtime ? { runtime } : {}), runtimeAlways: false } : undefined;
  }
  return undefined;
}

/** Download + unpacked size, plus the 2 GB kept free. Archives unpack to about 2.5× their size. */
export function cudaDiskBytesNeeded(asset: EnginePinAsset): number {
  return Math.ceil(asset.size * 3.5) + DEFAULT_HEADROOM_BYTES;
}

/** The CUDA engine was downloaded but can't run here: not retried until Re-check. */
export class CudaUnusable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CudaUnusable";
  }
}

/**
 * The official Linux CUDA build is compiled on Ubuntu 24.04 and needs glibc 2.38 or newer;
 * an older system can't load it at all, so there is no point downloading it.
 */
export const LINUX_CUDA_MIN_GLIBC = "2.38";

export function glibcVersion(): string | undefined {
  const report = process.report?.getReport() as
    { header?: { glibcVersionRuntime?: string } } | undefined;
  return report?.header?.glibcVersionRuntime;
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export class CudaSkipped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CudaSkipped";
  }
}

export interface CudaInstallOptions {
  readonly pin?: EnginePin;
  /** <userData>/engine */
  readonly engineDir: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (text: string, percent?: number) => void;
  /** For tests; read from the running process otherwise. */
  readonly glibcVersion?: string;
}

function extract(archive: string, into: string): Promise<void> {
  // bsdtar (Windows 10+, macOS) and GNU tar both unpack .tar.gz; Windows' tar.exe also unpacks .zip.
  return new Promise((resolve, reject) => {
    execFile(
      "tar",
      ["-xf", archive, "-C", into],
      { windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Couldn't unpack ${path.basename(archive)}: ${String(stderr).trim() || error.message}`,
            ),
          );
        } else {
          resolve();
        }
      },
    );
  });
}

async function moveLibrariesInto(fromDir: string, toDir: string): Promise<void> {
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(fromDir, entry.name);
    if (entry.isDirectory()) {
      await moveLibrariesInto(full, toDir);
    } else if (/\.(dll|so(\.\d+)*)$/i.test(entry.name)) {
      await rename(full, path.join(toDir, entry.name)).catch(async () => undefined);
    }
  }
}

async function probeCuda(
  serverPath: string,
): Promise<{ readonly devices: number; readonly systemTooOld: boolean }> {
  let output: string;
  try {
    output = await listEngineDevices(serverPath);
  } catch (error) {
    output = (error as { output?: string }).output ?? "";
  }
  return {
    devices: cudaDeviceCount(output),
    systemTooOld: /GLIBC_[\d.]+'? not found/.test(output),
  };
}

/** Linux: whether the CUDA backend library is missing NVIDIA's runtime (no CUDA toolkit installed). */
async function missingCudaRuntime(binDir: string): Promise<boolean> {
  const library = path.join(binDir, "libggml-cuda.so");
  if (!existsSync(library)) return true;
  const output = await new Promise<string>((resolve) => {
    execFile("ldd", [library], { timeout: 20_000 }, (error, stdout, stderr) =>
      resolve(`${String(stdout)}\n${String(stderr)}${error ? `\n${error.message}` : ""}`),
    );
  });
  return /lib(cudart|cublas|cublasLt)\.so[.\d]*\s*=>\s*not found/.test(output);
}

function cudaDeviceCount(output: string): number {
  return parseListDevices(output, Number.MAX_SAFE_INTEGER).filter(
    (device) => device.backend === "cuda",
  ).length;
}

export function cudaInstallDir(engineDir: string, pin: EnginePin = ENGINE_PIN): string {
  return path.join(engineDir, "cuda", pin.tag);
}

/** The CUDA server binary if a previous install finished. */
export async function installedCudaServer(
  engineDir: string,
  pin: EnginePin = ENGINE_PIN,
): Promise<string | undefined> {
  const dir = cudaInstallDir(engineDir, pin);
  try {
    const marker = JSON.parse(await readFile(path.join(dir, "ready.json"), "utf8")) as {
      serverPath?: unknown;
    };
    return typeof marker.serverPath === "string" && existsSync(marker.serverPath)
      ? marker.serverPath
      : undefined;
  } catch {
    return undefined;
  }
}

async function fetchAsset(
  asset: EnginePinAsset,
  options: CudaInstallOptions,
  intoDir: string,
  label: string,
): Promise<void> {
  const downloads = path.join(options.engineDir, "downloads");
  await mkdir(downloads, { recursive: true });
  const free = await freeDiskBytes(downloads).catch(() => undefined);
  const needed = cudaDiskBytesNeeded(asset);
  if (free !== undefined && free < needed) {
    throw new CudaSkipped(
      `Skipped the faster NVIDIA engine: it needs ${formatBytes(needed)} free on the disk (including 2 GB to spare), but only ${formatBytes(free)} is free. The standard engine keeps working.`,
    );
  }
  const archive = path.join(downloads, asset.name);
  await downloadFile({
    url: asset.url,
    destination: archive,
    expectedSize: asset.size,
    sha256: asset.sha256,
    sourceLabel: "GitHub",
    ...(options.signal ? { signal: options.signal } : {}),
    onProgress: (progress: DownloadProgress) => {
      const percent =
        progress.totalBytes > 0 ? (progress.receivedBytes / progress.totalBytes) * 100 : undefined;
      options.onProgress?.(
        `Downloading ${label} (${formatBytes(progress.receivedBytes)} of ${formatBytes(asset.size)})`,
        percent,
      );
    },
  });
  options.onProgress?.(`Unpacking ${label}…`);
  await mkdir(intoDir, { recursive: true });
  await extract(archive, intoDir);
  await rm(archive, { force: true });
}

/**
 * Downloads, unpacks and checks the CUDA engine; returns its llama-server. Throws CudaSkipped when
 * there is not enough disk space, or an Error with a plain reason when it can't be used.
 */
export async function installCudaEngine(options: CudaInstallOptions): Promise<string> {
  const pin = options.pin ?? ENGINE_PIN;
  const platform = options.platform ?? process.platform;
  const plan = cudaPlan(pin, platform, options.arch ?? process.arch);
  if (!plan) {
    throw new CudaSkipped("The NVIDIA engine isn't available for this system.");
  }
  const existing = await installedCudaServer(options.engineDir, pin);
  if (existing) return existing;
  if (platform === "linux") {
    const glibc = options.glibcVersion ?? glibcVersion();
    if (glibc && !versionAtLeast(glibc, LINUX_CUDA_MIN_GLIBC)) {
      throw new CudaSkipped(
        `Skipped the faster NVIDIA engine: it needs a newer version of Linux (glibc ${LINUX_CUDA_MIN_GLIBC} or later, as in Ubuntu 24.04; this one has ${glibc}). The standard engine keeps working.`,
      );
    }
  }

  const dir = cudaInstallDir(options.engineDir, pin);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await fetchAsset(plan.engine, options, dir, "the NVIDIA engine");
  const serverPath = findServerBinary(dir, platform);
  if (!serverPath) {
    throw new Error("The NVIDIA engine download didn't contain llama-server.");
  }
  const binDir = path.dirname(serverPath);
  const addRuntime = async () => {
    if (!plan.runtime) return false;
    const runtimeDir = path.join(dir, "runtime");
    await fetchAsset(plan.runtime, options, runtimeDir, "NVIDIA's runtime libraries");
    await moveLibrariesInto(runtimeDir, binDir);
    await rm(runtimeDir, { recursive: true, force: true });
    return true;
  };
  if (plan.runtimeAlways) {
    await addRuntime();
  }
  options.onProgress?.("Checking the NVIDIA engine…");
  let probe = await probeCuda(serverPath);
  if (
    probe.devices === 0 &&
    !plan.runtimeAlways &&
    !probe.systemTooOld &&
    (await missingCudaRuntime(binDir)) &&
    (await addRuntime())
  ) {
    // Linux without the CUDA toolkit: the engine needs NVIDIA's runtime libraries next to it.
    options.onProgress?.("Checking the NVIDIA engine…");
    probe = await probeCuda(serverPath);
  }
  if (probe.systemTooOld) {
    throw new CudaUnusable(
      "The faster NVIDIA engine needs a newer version of Linux (glibc 2.38 or later, as in Ubuntu 24.04). The standard engine keeps working.",
    );
  }
  if (probe.devices === 0) {
    throw new CudaUnusable(
      "The NVIDIA engine doesn't see your graphics card (the NVIDIA driver may be too old). The standard engine keeps working.",
    );
  }
  await writeFile(
    path.join(dir, "ready.json"),
    `${JSON.stringify({ serverPath, tag: pin.tag, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return serverPath;
}

/** Removes the CUDA engine (after it failed to start), so the space is not wasted. */
export async function removeCudaEngine(
  engineDir: string,
  pin: EnginePin = ENGINE_PIN,
): Promise<void> {
  const dir = cudaInstallDir(engineDir, pin);
  if (await stat(dir).catch(() => undefined)) {
    await rm(dir, { recursive: true, force: true });
  }
}
