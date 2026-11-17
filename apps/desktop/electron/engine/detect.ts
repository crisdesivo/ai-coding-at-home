import { execFile } from "node:child_process";
import os from "node:os";
import type { ComputerSpecs } from "./choose";
import { engineSpawnEnv } from "./locate";

/** One device `llama-server --list-devices` reports. */
export interface EngineDevice {
  /** "Vulkan1", "CUDA0", "MTL0". */
  readonly id: string;
  readonly backend: "vulkan" | "cuda" | "metal" | "other";
  readonly name: string;
  readonly totalMiB: number;
  readonly freeMiB: number;
  readonly nvidia: boolean;
  /** Shares system memory (an integrated GPU) or is a software renderer: not a graphics card. */
  readonly shared: boolean;
}

export interface DetectedComputer {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly ramBytes: number;
  readonly devices: readonly EngineDevice[];
  /** The dedicated GPU with the most memory, if any. */
  readonly gpu?: EngineDevice;
  readonly hasNvidia: boolean;
}

const DEVICE_LINE = /^\s*([A-Za-z_]+?)(\d*):\s+(.+?)\s+\((\d+)\s*MiB,\s*(\d+)\s*MiB free\)\s*$/;
const SOFTWARE_RENDERER = /llvmpipe|lavapipe|swiftshader|software rasterizer/i;
const NVIDIA = /nvidia|geforce|quadro|tesla|\brtx\b/i;
/** Integrated GPUs by name; they report (part of) system memory as their own. */
const INTEGRATED =
  /intel\(r\) (?:uhd|hd|iris|xe)|intel.*\b(?:uhd|iris|xe) graphics|intel\(r\) graphics|intel\(r\) arc\(tm\) graphics$|amd radeon\(tm\)(?: \w+)? graphics|radeon \d{3}m\b|radeon 80[56]0s|vega \d+ graphics|adreno|mali/i;
/** Names that are dedicated cards even when they report a lot of memory. */
const DEDICATED =
  /nvidia|geforce|quadro|tesla|\brx\s?\d|radeon pro|radeon vii|instinct|arc\(tm\) [ab]\d/i;

function backendOf(prefix: string): EngineDevice["backend"] {
  const lower = prefix.toLowerCase();
  if (lower === "vulkan") return "vulkan";
  if (lower === "cuda") return "cuda";
  if (lower === "mtl" || lower === "metal") return "metal";
  return "other";
}

/**
 * Parses `llama-server --list-devices`:
 *   Available devices:
 *     Vulkan0: Intel(R) Xe Graphics (TGL GT2) (29922 MiB, 27188 MiB free)
 *     Vulkan1: NVIDIA GeForce RTX 3050 Laptop GPU (4096 MiB, 996 MiB free)
 */
export function parseListDevices(output: string, ramBytes: number): EngineDevice[] {
  const devices: EngineDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = DEVICE_LINE.exec(line);
    if (!match) continue;
    const [, prefix = "", index = "", name = "", total = "0", free = "0"] = match;
    const totalMiB = Number(total);
    const backend = backendOf(prefix);
    const nvidia = NVIDIA.test(name);
    // Apple chips share memory by design; choose.ts sizes them from the RAM instead.
    const looksShared =
      backend !== "metal" &&
      (SOFTWARE_RENDERER.test(name) ||
        (INTEGRATED.test(name) && !DEDICATED.test(name)) ||
        // A device reporting half the system memory or more, with no dedicated-card name.
        (!DEDICATED.test(name) && totalMiB * 1024 * 1024 >= ramBytes * 0.5));
    devices.push({
      id: `${prefix}${index}`,
      backend,
      name: name.trim(),
      totalMiB,
      freeMiB: Number(free),
      nvidia,
      shared: looksShared,
    });
  }
  return devices;
}

export function largestDedicatedGpu(devices: readonly EngineDevice[]): EngineDevice | undefined {
  return devices
    .filter((device) => !device.shared && device.backend !== "metal")
    .reduce<EngineDevice | undefined>(
      (best, device) => (!best || device.totalMiB > best.totalMiB ? device : best),
      undefined,
    );
}

export function buildDetectedComputer(options: {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly ramBytes: number;
  readonly listDevicesOutput: string;
  readonly nvidiaSmi: boolean;
}): DetectedComputer {
  const devices = parseListDevices(options.listDevicesOutput, options.ramBytes);
  const gpu = largestDedicatedGpu(devices);
  return {
    platform: options.platform,
    arch: options.arch,
    ramBytes: options.ramBytes,
    devices,
    ...(gpu ? { gpu } : {}),
    hasNvidia: options.nvidiaSmi || devices.some((device) => device.nvidia && !device.shared),
  };
}

const GIB = 1024 ** 3;

export function computerSpecs(computer: DetectedComputer): ComputerSpecs {
  const ramGb = computer.ramBytes / GIB;
  if (computer.platform === "darwin") {
    return { kind: "mac", vramGb: 0, ramGb };
  }
  return { kind: "pc", vramGb: computer.gpu ? computer.gpu.totalMiB / 1024 : 0, ramGb };
}

/** Intel Macs are not supported: the engine is built for Apple chips only. */
export function unsupportedReason(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === "darwin" && arch !== "arm64") {
    return "This Mac has an Intel processor. AI Coding at Home needs a Mac with an Apple chip (M1 or newer).";
  }
  if ((platform === "win32" || platform === "linux") && arch !== "x64") {
    return `This computer's processor (${arch}) isn't supported yet. AI Coding at Home needs a 64-bit Intel or AMD processor.`;
  }
  return undefined;
}

function roundGb(bytes: number): string {
  return `${Math.round(bytes / GIB)} GB`;
}

/** "NVIDIA GeForce RTX 3050 Laptop GPU (4 GB) · 38 GB memory". */
export function describeComputer(computer: DetectedComputer): string {
  const memory = `${roundGb(computer.ramBytes)} memory`;
  if (computer.platform === "darwin") {
    const metal = computer.devices.find((device) => device.backend === "metal");
    return `${metal?.name ?? "Mac with Apple chip"} · ${memory}`;
  }
  if (!computer.gpu) {
    return `No graphics card found · ${memory}`;
  }
  return `${computer.gpu.name} (${roundGb(computer.gpu.totalMiB * 1024 * 1024)}) · ${memory}`;
}

function run(
  file: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs: number },
): Promise<{ readonly ok: boolean; readonly output: string; readonly error?: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const output = `${String(stdout)}\n${String(stderr)}`;
        resolve(error ? { ok: false, output, error: error.message } : { ok: true, output });
      },
    );
  });
}

export class DetectError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
    this.name = "DetectError";
  }
}

/** Runs the engine's own device listing; it sees the GPUs exactly as the engine will. */
export async function listEngineDevices(serverPath: string, timeoutMs = 60_000): Promise<string> {
  const result = await run(serverPath, ["--list-devices"], {
    ...engineSpawnEnv(serverPath),
    timeoutMs,
  });
  if (!result.ok && !DEVICE_LINE.test(result.output) && !/Available devices/i.test(result.output)) {
    throw new DetectError(
      `The AI engine could not check this computer's graphics hardware (${result.error ?? "unknown error"}).`,
      result.output,
    );
  }
  return result.output;
}

async function hasNvidiaSmi(platform: NodeJS.Platform): Promise<boolean> {
  if (platform !== "win32" && platform !== "linux") {
    return false;
  }
  const result = await run("nvidia-smi", ["-L"], { timeoutMs: 10_000 });
  return result.ok && /GPU \d+:/.test(result.output);
}

export async function detectComputer(serverPath: string): Promise<DetectedComputer> {
  const [listDevicesOutput, nvidiaSmi] = await Promise.all([
    listEngineDevices(serverPath),
    hasNvidiaSmi(process.platform),
  ]);
  return buildDetectedComputer({
    platform: process.platform,
    arch: process.arch,
    ramBytes: os.totalmem(),
    listDevicesOutput,
    nvidiaSmi,
  });
}
