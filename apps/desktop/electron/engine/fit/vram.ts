// Copied from localllmpicker (src/shared/vram.ts) unchanged apart from formatting and imports:
// the GGUF memory estimate, quant ladder and quant-quality model the app chooses its model with.
// Estimates the memory a GGUF model needs in llama.cpp (and Ollama, LM Studio):
// weights + KV cache + fixed state + overhead. The method and its sources are in
// reports/localllama/vram_estimation.md of the income growth project.
import type { ModelMemory } from "./memory";

const GiB = 1024 ** 3;

/** Bits per value of each KV cache type llama.cpp offers (-ctk / -ctv). */
export const KvCacheTypes = { f16: 16, q8_0: 8.5, q4_0: 4.5 } as const;
export type KvCacheType = keyof typeof KvCacheTypes;

/**
 * Bits per weight, used when no GGUF of the quant was found. Measured on
 * Mistral-7B (Artefact2's KL-divergence tables); Q8_0 and MXFP4 are by format.
 */
export const QuantBits: { [quant: string]: number } = {
  BF16: 16,
  F16: 16,
  Q8_0: 8.5,
  Q6_K: 6.57,
  Q5_K_M: 5.67,
  Q5_K_S: 5.52,
  Q4_K_M: 4.83,
  Q4_K_S: 4.57,
  IQ4_XS: 4.32,
  MXFP4: 4.25,
  Q3_K_M: 3.89,
  IQ3_M: 3.63,
  Q3_K_S: 3.5,
  Q2_K: 3,
  IQ2_M: 2.76,
  IQ2_XXS: 2.2,
  IQ1_S: 1.78,
};

/** llama.cpp's default micro-batch: the compute buffer holds this many tokens' logits. */
const ubatch = 512;

export type VramInput = {
  quant: string;
  contextTokens: number;
  kvCache: KvCacheType;
  /** Keep MoE expert weights in system RAM (llama.cpp --cpu-moe). */
  expertsInRam: boolean;
};

/** Sizes in bytes. */
export type VramEstimate = {
  weights: number;
  /** The GGUF repo the weight size was read from, or null when estimated from parameters. */
  weightsFrom: string | null;
  /** Expert weights moved to system RAM, 0 unless expertsInRam. */
  ram: number;
  kvCache: number;
  state: number;
  overhead: number;
  /** The image projector, needed only when sending images. */
  vision: number | null;
  /** vram (or layersInRam, when split) includes the image projector. */
  withVision?: boolean;
  vram: number;
  /** Layers (weights and their cache) moved to system RAM to fit the VRAM, 0 unless offloaded. */
  layersInRam: number;
  /** Share of the model (weights, cache, state) on the GPU: below 1 it runs slower. */
  gpuShare: number;
  /** The context asked for is longer than the model supports. */
  overMaxContext: boolean;
};

/**
 * The quants to offer for a model, biggest first: the usual ones, its native
 * quant (MXFP4 for gpt-oss), and any other found as a GGUF.
 */
export function quantsFor(memory: ModelMemory | undefined): string[] {
  const quants = new Set(Object.keys(QuantBits).filter((quant) => quant !== "MXFP4"));
  if (memory) quants.add(nativeQuant(memory));
  for (const quant of Object.keys(memory?.gguf ?? {})) quants.add(quant);
  return [...quants].sort((a, b) => quantBits(b, memory) - quantBits(a, memory));
}

/**
 * The quant matching the precision a model ships in: the fewest-bits quant
 * that loses nothing against it (quantQuality). MXFP4 for gpt-oss, Q8_0 for
 * an FP8 model, BF16 for the rest.
 */
export function nativeQuant(memory: ModelMemory): string {
  let best = "BF16";
  for (const [quant, bits] of Object.entries(QuantBits))
    if (bits >= memory.nativeBits - 0.01 && bits < (QuantBits[best] ?? 16)) best = quant;
  return best;
}

/**
 * Bits per weight of a quant: from QuantBits, or for another GGUF type
 * (Q4_0, IQ3_XXS, bartowski's Q4_K_L...) from its file size against the
 * model's closest-sized quant of known bits. 0 when neither is known.
 */
export function quantBits(quant: string, memory: ModelMemory | undefined): number {
  const known = QuantBits[quant];
  if (known) return known;
  const file = memory?.gguf[quant];
  if (!file) return 0;
  let best: { bits: number; ratio: number } | undefined;
  for (const [ref, refFile] of Object.entries(memory.gguf)) {
    const bits = QuantBits[ref];
    if (!bits || !refFile.bytes) continue;
    const ratio = file.bytes / refFile.bytes;
    if (!best || Math.abs(Math.log(ratio)) < Math.abs(Math.log(best.ratio))) best = { bits, ratio };
  }
  return best ? best.bits * best.ratio : 0;
}

/**
 * For a quant without its own KL measurement (QuantKl): the measured quants
 * just smaller and just bigger in bits per weight, which bound its quality
 * only roughly, since quant types differ in quality per bit. Undefined when
 * the quant's size is unknown.
 */
export function measuredNeighbours(
  quant: string,
  memory: ModelMemory | undefined,
): { below?: string; above?: string } | undefined {
  const bits = quantBits(quant, memory);
  if (!bits) return;
  const out: { below?: string; above?: string } = {};
  for (const q of Object.keys(QuantKl)) {
    const qBits = QuantBits[q];
    if (q === "MXFP4" || !qBits) continue;
    if (qBits <= bits) {
      if (!out.below || qBits > (QuantBits[out.below] ?? 0)) out.below = q;
    } else if (!out.above || qBits < (QuantBits[out.above] ?? 0)) out.above = q;
  }
  return out;
}

/** Returns undefined when neither a GGUF size nor a parameter count is known. */
export function estimateVram(
  memory: ModelMemory,
  paramsB: number | null,
  input: VramInput,
): VramEstimate | undefined {
  const file = memory.gguf[input.quant];
  const bits = QuantBits[input.quant];
  const weights = file?.bytes ?? (paramsB && bits ? (paramsB * 1e9 * bits) / 8 : 0);
  if (!weights) return;

  const share = input.expertsInRam ? (memory.expertShare ?? 0) : 0;
  const ram = weights * share;
  const kvScale = KvCacheTypes[input.kvCache] / 16;
  const context = Math.max(0, input.contextTokens);
  const sliding = Math.min(context, memory.slidingTokens);
  const kvCache = (memory.kvPerToken * context + memory.slidingPerToken * sliding) * kvScale;
  // CUDA context and allocator slack, the logits buffer, and a little per GB of
  // weights. A rough guess until it's calibrated against real llama.cpp runs.
  const overhead = 0.5 * GiB + ubatch * memory.vocab * 4 + 0.02 * (weights - ram);
  const vram = weights - ram + kvCache + memory.stateBytes + overhead;
  return {
    weights,
    weightsFrom: file?.repo ?? null,
    ram,
    kvCache,
    state: memory.stateBytes,
    overhead,
    vision: memory.mmprojBytes,
    vram,
    layersInRam: 0,
    gpuShare: ram ? (vram - overhead) / (vram - overhead + ram) : 1,
    overMaxContext: memory.maxContext != null && context > memory.maxContext,
  };
}

/**
 * The estimate with the image projector loaded too, for sending images. It
 * goes on the GPU with the layers, so it can spill to RAM like them.
 */
export function addVision(estimate: VramEstimate): VramEstimate {
  if (!estimate.vision) return estimate;
  const vram = estimate.vram + estimate.vision;
  const onGpu = vram - estimate.overhead;
  return {
    ...estimate,
    withVision: true,
    vram,
    gpuShare: estimate.ram ? onGpu / (onGpu + estimate.ram) : 1,
  };
}

/**
 * Moves enough layers to system RAM (llama.cpp -ngl) to fit vramBytes: their
 * weights and cache go to RAM, the GPU keeps the compute buffers. Undefined if
 * even that can't fit; the estimate unchanged if it already fits.
 */
export function splitLayers(estimate: VramEstimate, vramBytes: number): VramEstimate | undefined {
  const moved = estimate.vram - vramBytes;
  if (moved <= 0) return estimate;
  const onGpu = estimate.vram - estimate.overhead;
  if (moved >= onGpu) return;
  return {
    ...estimate,
    vram: estimate.vram - moved,
    layersInRam: moved,
    gpuShare: (onGpu - moved) / (onGpu + estimate.ram),
  };
}

export type FitInput = {
  vramGb: number;
  /** System RAM free for MoE experts and offloaded layers; 0 keeps everything in VRAM. */
  ramGb: number;
  /** Allow moving layers to RAM when the model doesn't fit otherwise (slower). */
  allowLayerOffload: boolean;
  contextTokens: number;
  kvCache: KvCacheType;
  /** The fewest-bits quant worth considering, e.g. Q4_K_M. */
  minQuant: string;
  /** Sending images: the image projector needs memory too, and models without one don't fit. */
  includeVision?: boolean;
};

export type Fit = { quant: string; expertsInRam: boolean; estimate: VramEstimate };

/**
 * How much of a Mac's unified memory the GPU may use by default, in GB: about
 * 2/3 up to 36 GB, 3/4 above. The rest stays with macOS. Users can raise it
 * with sudo sysctl iogpu.wired_limit_mb.
 */
export function macGpuMemoryGb(totalGb: number): number {
  return totalGb * (totalGb <= 36 ? 2 / 3 : 3 / 4);
}

/**
 * When layers have to go to RAM, a higher quant isn't worth more of them:
 * the smallest quant within this much quality of the best that fits wins.
 */
const offloadQualityTolerance = 0.02;

/**
 * The best quant of a model that fits, down to minQuant (the model's native
 * quant, like MXFP4 for gpt-oss, is always allowed). First the highest quant
 * that fits fully in VRAM, or for a MoE model with its experts in system RAM
 * when RAM is given, but never above the precision the model ships in: past it
 * a quant only costs memory (BF16 of gpt-oss, which ships in MXFP4, keeps the
 * same quality as MXFP4). Only if none fits, and layer offload is allowed, layers go to RAM,
 * using the smallest quant within 2% of the best quality that fits, since
 * every layer in RAM slows generation. Undefined when nothing fits, the
 * context is longer than the model supports, or images are sent to a model
 * without an image projector.
 */
export function bestFit(
  memory: ModelMemory,
  paramsB: number | null,
  input: FitInput,
): Fit | undefined {
  if (input.includeVision && memory.mmprojBytes == null) return;
  const vram = input.vramGb * GiB;
  const ram = input.ramGb * GiB;
  const floor = QuantBits[input.minQuant] ?? 0;
  const experts = input.ramGb > 0 && (memory.expertShare ?? 0) > 0;
  const native = nativeQuant(memory);
  const quants = quantsFor(memory).filter((q) => q === native || (QuantBits[q] ?? 0) >= floor);
  const quality = (quant: string) => quantQuality(quant, paramsB, memory.nativeBits);
  const estimate = (quant: string, expertsInRam: boolean) => {
    const est = estimateVram(memory, paramsB, {
      quant,
      contextTokens: input.contextTokens,
      kvCache: input.kvCache,
      expertsInRam,
    });
    return est && input.includeVision ? addVision(est) : est;
  };

  // Each quant's first placement that fits: all in VRAM, else experts in RAM.
  const inVram: (Fit & { quality: number })[] = [];
  for (const quant of quants) {
    for (const expertsInRam of experts ? [false, true] : [false]) {
      const est = estimate(quant, expertsInRam);
      if (!est) continue;
      if (est.overMaxContext) return;
      if (est.vram <= vram && est.ram <= ram) {
        inVram.push({
          quant,
          expertsInRam,
          estimate: est,
          quality: quality(quant),
        });
        break;
      }
    }
  }
  if (inVram.length) {
    // By bits per weight, not file size: gpt-oss GGUFs keep their experts in
    // MXFP4 whatever the name, so Q4_K_M's file can come out smaller than
    // MXFP4's, though only MXFP4 keeps the rest at full quality.
    const bits = (fit: Fit) => quantBits(fit.quant, memory);
    const cap = quantBits(native, memory) + 1e-9;
    const [pick] = inVram
      .filter((fit) => bits(fit) <= cap)
      .sort((a, b) => bits(b) - bits(a) || a.estimate.weights - b.estimate.weights);
    return (
      pick && {
        quant: pick.quant,
        expertsInRam: pick.expertsInRam,
        estimate: pick.estimate,
      }
    );
  }
  if (!input.allowLayerOffload) return;

  // Experts go to RAM before whole layers do: they're the cheaper part to move.
  const fits: (Fit & { quality: number })[] = [];
  for (const quant of quants) {
    const est = estimate(quant, experts);
    const split = est && splitLayers(est, vram);
    if (split && split.ram + split.layersInRam <= ram)
      fits.push({
        quant,
        expertsInRam: experts,
        estimate: split,
        quality: quality(quant),
      });
  }
  const best = Math.max(...fits.map((fit) => fit.quality));
  const [pick] = fits
    .filter((fit) => fit.quality >= best - offloadQualityTolerance)
    .sort((a, b) => a.estimate.layersInRam - b.estimate.layersInRam);
  return (
    pick && {
      quant: pick.quant,
      expertsInRam: pick.expertsInRam,
      estimate: pick.estimate,
    }
  );
}

/**
 * Mean KL divergence from the full model of standard imatrix quants of a
 * modern ~30B model: bartowski's and Unsloth's measurements of Qwen3.5-35B-A3B.
 * Q2_K, Q3_K_S, IQ3_M, IQ2_M and IQ1_S aren't in those tables and are placed
 * by their ratio to measured neighbours on Mistral-7B (Artefact2) and Gemma 3
 * 27B (Unsloth). Method: reports/localllama/quant_quality.md of the income
 * growth project.
 */
export const QuantKl: { [quant: string]: number } = {
  BF16: 0,
  F16: 0,
  Q8_0: 0.0026,
  Q6_K: 0.0041,
  Q5_K_M: 0.0069,
  Q5_K_S: 0.008,
  Q4_K_M: 0.0182,
  IQ4_XS: 0.0234,
  Q4_K_S: 0.025,
  MXFP4: 0.0272,
  Q3_K_M: 0.0585,
  IQ3_M: 0.065,
  Q3_K_S: 0.075,
  Q2_K: 0.15,
  IQ2_M: 0.17,
  IQ2_XXS: 0.35,
  IQ1_S: 0.65,
};

/**
 * The same quant moves a small model's outputs further than a big one's:
 * small models degrade at lower bit widths (Helcig et al. 2026, Fig. 1b; Lee
 * et al. 2025), giant MoE models hold up best (Zhao et al. 2025). 1 at ~30B.
 */
function klSizeFactor(paramsB: number | null): number {
  if (paramsB == null) return 1;
  if (paramsB < 4) return 3;
  if (paramsB < 10) return 1.8;
  if (paramsB < 25) return 1.3;
  if (paramsB < 100) return 1;
  return 0.6;
}

/**
 * KL divergence at which half a model's capability on hard tasks is gone.
 * Retention is flat at small divergence and falls with its square past this
 * point: 1 / (1 + (KL / k50)²) fits Unsloth's Gemma 3 27B MMLU ladder within
 * 1% (midpoint 1.16 there). Hard, long-output tasks break much earlier:
 * DeepSeek-V3-0324 at Q2_K_L kept 96% of MMLU but 54% of AIME (Zhao et al.
 * 2025), which puts their midpoint near 0.2. All use is treated as hard:
 * coding, agents and reasoning are what people run local models for.
 */
const k50 = 0.2;

/**
 * Roughly how much of the full model's capability a quant keeps, 0 to 1.
 * Nearly all down to 4 bits, then it falls fast: quality isn't linear in the
 * quant's loss. A model that ships in low precision (gpt-oss in MXFP4) loses
 * nothing at quants at or above it.
 */
export function quantQuality(quant: string, paramsB: number | null, nativeBits = 16): number {
  const bits = QuantBits[quant] ?? 16;
  if (bits >= nativeBits - 0.01) return 1;
  const kl = (QuantKl[quant] ?? 0) * klSizeFactor(paramsB);
  return 1 / (1 + (kl / k50) ** 2);
}

/** GPU memory is sold in GiB but labeled "GB", so sizes are shown that way. */
export function gb(bytes: number): string {
  const value = bytes / GiB;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} GB`;
}
