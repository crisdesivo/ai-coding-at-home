import {
  CONTEXT_TOKENS,
  KV_CACHE,
  MAX_QUANT,
  MIN_QUANT,
  MODEL_CATALOG,
  BASIC_MODEL_ID,
  modelMemory,
  totalBytes,
  type CatalogFile,
  type CatalogModel,
} from "./catalog";
import { scaleRating } from "./fit/capability";
import {
  QuantBits,
  estimateVram,
  macGpuMemoryGb,
  nativeQuant,
  quantBits,
  quantQuality,
  quantsFor,
} from "./fit/vram";

/**
 * Picks the model and its quant for a computer. Pure: hardware, free disk and download progress
 * in, a choice (or the reason there is none) out.
 *
 * Like localllmpicker's recommendations (server/bot.ts `recommend`): for every model, the best
 * quant that fits (never above Q6_K or the precision the model ships in), scored as
 * `scaleRating(model score, quantQuality(quant))`; the highest score wins. The fit test is the
 * user's rule for 100k-token coding instead of bestFit's own: `needed` is localllmpicker's
 * estimateVram at 102,400 tokens with an 8-bit KV cache, and
 * - with a usable GPU (an Apple chip's GPU share of unified memory counts as its VRAM): at least
 *   60% of `needed` fits in VRAM, and the rest fits in the system RAM left after the OS and app;
 * - without one: `needed` ≤ 20% of the system RAM;
 * - and the download leaves 2 GB free on the disk.
 */
export interface ComputerSpecs {
  readonly kind: "pc" | "mac";
  /** Largest dedicated GPU's memory in GiB; 0 when there is none. Ignored on a Mac. */
  readonly vramGb: number;
  /** Total system memory in GiB. */
  readonly ramGb: number;
}

export interface ChooseInput {
  readonly computer: ComputerSpecs;
  /** Free bytes on the drive that holds the models folder; undefined skips the disk rule. */
  readonly diskFreeBytes?: number;
  /** Bytes already on disk per `modelId:quant` (finished parts and `.part` files). */
  readonly downloadedBytes?: Readonly<Record<string, number>>;
  /** The model already downloaded completely: it needs no disk space. */
  readonly installed?: { readonly modelId: string; readonly quant: string };
  readonly catalog?: readonly CatalogModel[];
}

export interface ModelChoice {
  readonly model: CatalogModel;
  readonly quant: string;
  readonly files: readonly CatalogFile[];
  readonly sizeBytes: number;
  /** Weights + KV cache at 100k + overhead, GiB. */
  readonly neededGb: number;
  /** Share of the full model's quality the quant keeps, 0 to 1. */
  readonly quality: number;
  readonly score: number;
  /** Part of the model runs from system memory: replies are a bit slower. */
  readonly partlyInSystemMemory: boolean;
}

export type ChooseResult =
  | {
      readonly kind: "ok";
      readonly choice: ModelChoice;
      /** The best choice for the hardware; differs from `choice` when the disk was too full. */
      readonly hardwarePick: ModelChoice;
      readonly limitedByDisk: boolean;
      /** Only the smallest model fits: coding help will be basic. */
      readonly basic: boolean;
    }
  | {
      /** No model fits this computer's memory, even at its smallest quant. */
      readonly kind: "too-small";
      /** The model and quant needing the least memory, for the message. */
      readonly smallest: {
        readonly model: CatalogModel;
        readonly quant: string;
        readonly neededGb: number;
      };
    }
  | {
      /** A model fits the hardware, but none fits on the disk. */
      readonly kind: "no-disk";
      readonly hardwarePick: ModelChoice;
      /** Free space the smallest fitting download needs (download + 2 GB). */
      readonly neededBytes: number;
      readonly freeBytes: number;
    };

/** Space kept free on the disk after any download. */
export const DISK_HEADROOM_BYTES = 2e9;
/** System memory kept for the OS and the app itself, GiB. */
export const OS_RESERVE_GB = 4;
const MIN_GPU_SHARE = 0.6;
const CPU_ONLY_RAM_SHARE = 0.2;
const GiB = 1024 ** 3;

/** macOS lets the GPU use ~2/3 of unified memory up to 36 GB, ~3/4 above (localllmpicker). */
export function appleGpuShareGb(ramGb: number): number {
  return macGpuMemoryGb(ramGb);
}

/** The memory a model can use on this computer: GPU part and system-memory part, GiB. */
export function memoryBudget(computer: ComputerSpecs): {
  readonly vramGb: number;
  readonly systemGb: number;
} {
  if (computer.kind === "mac") {
    const share = appleGpuShareGb(computer.ramGb);
    return { vramGb: share, systemGb: Math.max(0, computer.ramGb - share - OS_RESERVE_GB) };
  }
  return {
    vramGb: Math.max(0, computer.vramGb),
    systemGb: Math.max(0, computer.ramGb - OS_RESERVE_GB),
  };
}

export function fitsHardware(neededGb: number, computer: ComputerSpecs): boolean {
  const { vramGb, systemGb } = memoryBudget(computer);
  if (vramGb > 0) {
    return neededGb * MIN_GPU_SHARE <= vramGb && Math.max(0, neededGb - vramGb) <= systemGb;
  }
  return neededGb <= computer.ramGb * CPU_ONLY_RAM_SHARE;
}

/** GiB a model needs at a quant with a 100k-token conversation; undefined if it can't hold one. */
export function neededGb(model: CatalogModel, quant: string): number | undefined {
  const estimate = estimateVram(modelMemory(model), model.paramsB, {
    quant,
    contextTokens: CONTEXT_TOKENS,
    kvCache: KV_CACHE,
    expertsInRam: false,
  });
  if (!estimate || estimate.overMaxContext) return undefined;
  return estimate.vram / GiB;
}

/** Bytes a download still needs on disk, including the 2 GB kept free. */
export function diskBytesNeeded(
  sizeBytes: number,
  downloadedBytes: number,
  installed: boolean,
): number {
  if (installed) return 0;
  return Math.max(0, sizeBytes - Math.max(0, downloadedBytes)) + DISK_HEADROOM_BYTES;
}

export function downloadKey(modelId: string, quant: string): string {
  return `${modelId}:${quant}`;
}

/**
 * Every quant of a model worth considering, with what it needs: at least MIN_QUANT, at most MAX_QUANT
 * (Q6_K) and never above the precision the model ships in.
 */
export function quantOptions(model: CatalogModel, computer: ComputerSpecs): ModelChoice[] {
  const memory = modelMemory(model);
  const native = nativeQuant(memory);
  const floor = QuantBits[MIN_QUANT] ?? 0;
  const cap = Math.min(quantBits(native, memory), QuantBits[MAX_QUANT] ?? Infinity) + 1e-9;
  const { vramGb } = memoryBudget(computer);
  const options: ModelChoice[] = [];
  for (const quant of quantsFor(memory)) {
    const files = model.quants[quant];
    if (!files?.length) continue;
    const bits = quantBits(quant, memory);
    if (quant !== native && (QuantBits[quant] ?? 0) < floor) continue;
    if (bits > cap) continue;
    const needed = neededGb(model, quant);
    if (needed === undefined) continue;
    const quality = quantQuality(quant, model.paramsB, memory.nativeBits);
    options.push({
      model,
      quant,
      files,
      sizeBytes: totalBytes(files),
      neededGb: needed,
      quality,
      score: scaleRating(model.score, quality),
      partlyInSystemMemory: needed > vramGb,
    });
  }
  // Highest bits first; equal bits: the smaller file (bestFit's order).
  return options.sort(
    (a, b) =>
      quantBits(b.quant, modelMemory(b.model)) - quantBits(a.quant, modelMemory(a.model)) ||
      a.sizeBytes - b.sizeBytes,
  );
}

/**
 * When part of a model has to go to system memory, a higher quant isn't worth more of it: like
 * localllmpicker's bestFit, the quant with the least in system memory among those within this much
 * quality of the best that fits.
 */
const OFFLOAD_QUALITY_TOLERANCE = 0.02;

/**
 * One model's quant among those that fit (sorted most bits first): the highest when it fits on the
 * GPU entirely; otherwise the one with the least in system memory within 2% quality of the best,
 * the higher quant on a tie (bestFit's two branches).
 */
export function pickQuant(
  fitting: readonly ModelChoice[],
  computer: ComputerSpecs,
): ModelChoice | undefined {
  const top = fitting[0];
  if (!top) return undefined;
  const { vramGb } = memoryBudget(computer);
  if (top.neededGb <= vramGb) return top;
  const bestQuality = Math.max(...fitting.map((option) => option.quality));
  const offload = (option: ModelChoice) => Math.max(0, option.neededGb - vramGb);
  return fitting
    .filter((option) => option.quality >= bestQuality - OFFLOAD_QUALITY_TOLERANCE)
    .reduce((pick, option) => (offload(option) < offload(pick) ? option : pick));
}

function best(choices: readonly ModelChoice[]): ModelChoice | undefined {
  // Highest score; on a tie the earlier catalog model (stable sort).
  return [...choices].sort((a, b) => b.score - a.score)[0];
}

export function chooseModel(input: ChooseInput): ChooseResult {
  const catalog = input.catalog ?? MODEL_CATALOG;
  const disk = (choice: ModelChoice) =>
    diskBytesNeeded(
      choice.sizeBytes,
      input.downloadedBytes?.[downloadKey(choice.model.id, choice.quant)] ?? 0,
      input.installed?.modelId === choice.model.id && input.installed.quant === choice.quant,
    );
  const fitsDisk = (choice: ModelChoice) =>
    input.diskFreeBytes === undefined ||
    disk(choice) <= DISK_HEADROOM_BYTES ||
    disk(choice) <= input.diskFreeBytes;

  const hardwareBest: ModelChoice[] = [];
  const diskBest: ModelChoice[] = [];
  const allFitting: ModelChoice[] = [];
  let smallest: { model: CatalogModel; quant: string; neededGb: number } | undefined;
  for (const model of catalog) {
    const options = quantOptions(model, input.computer);
    for (const option of options) {
      if (!smallest || option.neededGb < smallest.neededGb) {
        smallest = { model, quant: option.quant, neededGb: option.neededGb };
      }
    }
    const fitting = options.filter((option) => fitsHardware(option.neededGb, input.computer));
    allFitting.push(...fitting);
    const top = pickQuant(fitting, input.computer);
    if (top) hardwareBest.push(top);
    const onDisk = pickQuant(fitting.filter(fitsDisk), input.computer);
    if (onDisk) diskBest.push(onDisk);
  }

  const hardwarePick = best(hardwareBest);
  if (!hardwarePick) {
    if (!smallest) throw new Error("The model catalog is empty.");
    return { kind: "too-small", smallest };
  }
  const choice = best(diskBest);
  if (!choice) {
    const neededBytes = Math.min(...allFitting.map(disk));
    return {
      kind: "no-disk",
      hardwarePick,
      neededBytes,
      freeBytes: input.diskFreeBytes ?? 0,
    };
  }
  return {
    kind: "ok",
    choice,
    hardwarePick,
    limitedByDisk: choice.model.id !== hardwarePick.model.id || choice.quant !== hardwarePick.quant,
    basic: choice.model.id === BASIC_MODEL_ID,
  };
}
