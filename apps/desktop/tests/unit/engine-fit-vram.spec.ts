// Copied from localllmpicker (src/shared/vram.test.ts), run with Playwright's runner instead of node:test.
import assert from "node:assert/strict";
import { test } from "@playwright/test";
import type { ModelMemory } from "../../electron/engine/fit/memory";
import {
  bestFit,
  estimateVram,
  gb,
  macGpuMemoryGb,
  measuredNeighbours,
  nativeQuant,
  quantBits,
  quantQuality,
  quantsFor,
  splitLayers,
} from "../../electron/engine/fit/vram";

const GiB = 1024 ** 3;
const KiB = 1024;

const qwen3_32b: ModelMemory = {
  design: "gqa",
  verified: true,
  kvPerToken: 256 * KiB,
  slidingPerToken: 0,
  slidingTokens: 0,
  stateBytes: 0,
  note: null,
  maxContext: 40960,
  vocab: 151936,
  expertShare: 0,
  expertsUsed: null,
  nativeBits: 16,
  gguf: { Q4_K_M: { bytes: 19.8e9, repo: "bartowski/Qwen_Qwen3-32B-GGUF" } },
  mmprojBytes: null,
};

// Gemma 3 27B: 10 global and 52 sliding layers, 16 KV heads of 128.
const gemma3_27b: ModelMemory = {
  ...qwen3_32b,
  design: "sliding",
  kvPerToken: 10 * 8 * KiB,
  slidingPerToken: 52 * 8 * KiB,
  slidingTokens: 1536,
  maxContext: 131072,
  gguf: {},
};

const input = {
  quant: "Q4_K_M",
  contextTokens: 32768,
  kvCache: "f16",
  expertsInRam: false,
} as const;

test("a plain GQA model: 256 KiB per token is 8 GiB of cache at 32k", () => {
  const est = estimateVram(qwen3_32b, 32.8, input);
  assert.ok(est);
  assert.equal(est.kvCache, 8 * GiB);
  assert.equal(est.weights, 19.8e9);
  assert.equal(est.weightsFrom, "bartowski/Qwen_Qwen3-32B-GGUF");
  assert.equal(est.vram, est.weights + est.kvCache + est.state + est.overhead - est.ram);
});

test("a q8_0 cache takes 8.5 of 16 bits", () => {
  const est = estimateVram(qwen3_32b, 32.8, { ...input, kvCache: "q8_0" });
  assert.equal(est?.kvCache, 8 * GiB * (8.5 / 16));
});

test("sliding layers stop growing at their window", () => {
  const short = estimateVram(gemma3_27b, 27.4, { ...input, contextTokens: 1000 });
  const long = estimateVram(gemma3_27b, 27.4, input);
  assert.equal(short?.kvCache, (80 * KiB + 416 * KiB) * 1000);
  // 2.5 GiB for the global layers plus 0.61 GiB of sliding cache.
  assert.equal(long?.kvCache, 80 * KiB * 32768 + 416 * KiB * 1536);
});

test("without a GGUF, weights come from the parameter count", () => {
  const est = estimateVram(gemma3_27b, 27.4, input);
  assert.equal(est?.weights, (27.4e9 * 4.83) / 8);
  assert.equal(est?.weightsFrom, null);
  assert.equal(estimateVram(gemma3_27b, null, input), undefined);
});

test("MoE experts in RAM leave the rest in VRAM", () => {
  const moe = { ...qwen3_32b, expertShare: 0.9 };
  const est = estimateVram(moe, 32.8, { ...input, expertsInRam: true });
  assert.ok(est);
  assert.equal(est.ram, 19.8e9 * 0.9);
  assert.ok(est.vram < 12 * GiB);
});

test("flags a context longer than the model supports", () => {
  const est = estimateVram(qwen3_32b, 32.8, { ...input, contextTokens: 131072 });
  assert.equal(est?.overMaxContext, true);
});

test("quants are offered from most to fewest bits, with found GGUFs included", () => {
  const quants = quantsFor({
    ...qwen3_32b,
    gguf: { MXFP4: { bytes: 1, repo: "x" } },
  });
  assert.equal(quants[0], "BF16");
  assert.ok(quants.includes("MXFP4"));
  assert.ok(!quantsFor(qwen3_32b).includes("MXFP4"));
  // A model that ships in MXFP4 is offered it without a GGUF of it.
  assert.ok(quantsFor({ ...qwen3_32b, nativeBits: 4.25 }).includes("MXFP4"));
});

test("a model's native quant is the smallest that loses nothing against it", () => {
  assert.equal(nativeQuant(qwen3_32b), "BF16");
  assert.equal(nativeQuant({ ...qwen3_32b, nativeBits: 8 }), "Q8_0");
  assert.equal(nativeQuant({ ...qwen3_32b, nativeBits: 4.25 }), "MXFP4");
});

// Real Qwen3.6-27B GGUF sizes: Q4_0 and IQ3_XXS have no standard bits.
const withOddQuants: ModelMemory = {
  ...qwen3_32b,
  gguf: {
    Q4_K_M: { bytes: 16_545_000_000, repo: "x" },
    Q4_0: { bytes: 15_650_000_000, repo: "x" },
    IQ3_XXS: { bytes: 12_839_109_120, repo: "x" },
    IQ3_M: { bytes: 14_115_852_800, repo: "x" },
  },
};

test("GGUF quants without standard bits sit where their file size puts them", () => {
  const quants = quantsFor(withOddQuants);
  const at = (q: string) => quants.indexOf(q);
  assert.ok(at("Q4_0") > at("Q4_K_M") && at("Q4_0") < at("Q3_K_M"));
  assert.ok(at("IQ3_XXS") > at("IQ3_M") && at("IQ3_XXS") < at("Q2_K"));
  assert.equal(quants.at(-1), "IQ1_S");
  // Sized against the closest known quant: IQ3_M for IQ3_XXS.
  assert.ok(Math.abs(quantBits("IQ3_XXS", withOddQuants) - 3.63 * 0.9096) < 0.01);
  assert.equal(quantBits("IQ3_XXS", qwen3_32b), 0);
});

test("an unmeasured quant is bounded by the measured quants on either side of its size", () => {
  assert.deepEqual(measuredNeighbours("Q4_0", withOddQuants), {
    below: "IQ4_XS",
    above: "Q4_K_S",
  });
  assert.deepEqual(measuredNeighbours("IQ3_XXS", withOddQuants), {
    below: "Q2_K",
    above: "Q3_K_S",
  });
  // Smaller than every measured quant: only a bigger one bounds it.
  const tiny = {
    ...withOddQuants,
    gguf: { ...withOddQuants.gguf, IQ1_M: { bytes: 6e9, repo: "x" } },
  };
  assert.deepEqual(measuredNeighbours("IQ1_M", tiny), { above: "IQ1_S" });
  assert.equal(measuredNeighbours("IQ3_XXS", qwen3_32b), undefined);
});

const fit = {
  vramGb: 24,
  ramGb: 0,
  allowLayerOffload: false,
  contextTokens: 32768,
  kvCache: "f16",
  minQuant: "Q4_K_M",
} as const;

// A dense 8B: no GGUF sizes, so weights come from the parameter count.
const dense8b: ModelMemory = {
  ...qwen3_32b,
  kvPerToken: 144 * KiB,
  maxContext: 32768,
  gguf: {},
};

test("with layer offload, a model too big for the VRAM runs partly from RAM", () => {
  const scenario = { ...fit, vramGb: 3.8, ramGb: 10, contextTokens: 500 };
  assert.equal(bestFit(dense8b, 8, scenario), undefined);
  const best = bestFit(dense8b, 8, { ...scenario, allowLayerOffload: true });
  assert.ok(best);
  assert.ok(best.estimate.vram <= 3.8 * GiB);
  assert.ok(best.estimate.layersInRam > 0);
  assert.ok(best.estimate.layersInRam <= 10 * GiB);
  assert.ok(best.estimate.gpuShare > 0.3 && best.estimate.gpuShare < 1);
  // Q8_0 also fits from RAM, but isn't worth the extra layers in RAM: the
  // smallest quant within 2% of its quality wins.
  assert.equal(best.quant, "Q5_K_S");
});

test("layers only go to RAM when nothing fits without it", () => {
  const best = bestFit(dense8b, 8, {
    ...fit,
    vramGb: 12,
    contextTokens: 500,
    allowLayerOffload: true,
    ramGb: 10,
  });
  // Q8_0 fits the 12 GB as is (BF16 doesn't), so nothing goes to RAM.
  assert.equal(best?.estimate.layersInRam, 0);
  assert.equal(best?.quant, "Q8_0");
});

test("splitting layers keeps the overhead on the GPU", () => {
  const est = estimateVram(dense8b, 8, {
    quant: "Q4_K_M",
    contextTokens: 500,
    kvCache: "f16",
    expertsInRam: false,
  });
  assert.ok(est);
  assert.equal(splitLayers(est, est.vram), est);
  assert.equal(splitLayers(est, est.overhead), undefined);
  const half = splitLayers(est, est.vram / 2);
  assert.ok(half && half.vram === est.vram / 2);
});

test("the best fit is the highest quant that fits", () => {
  // 27.4B at Q5_K_M is about 18 GiB of weights plus 3.1 GiB of cache: fits 24 GB.
  assert.equal(bestFit(gemma3_27b, 27.4, fit)?.quant, "Q5_K_M");
  assert.equal(bestFit(gemma3_27b, 27.4, { ...fit, vramGb: 12 }), undefined);
  // A model shipped in 16 bits gets BF16 when there is room for it.
  assert.equal(bestFit(gemma3_27b, 27.4, { ...fit, vramGb: 80 })?.quant, "BF16");
});

// gpt-oss-20b: ships in MXFP4.
const gptOss20b: ModelMemory = {
  ...qwen3_32b,
  nativeBits: 4.25,
  maxContext: 131072,
  gguf: {},
};

test("a model shipped in MXFP4 fits at MXFP4, not BF16, when both fit", () => {
  const roomy = { ...fit, vramGb: 80, contextTokens: 8192 };
  assert.ok(estimateVram(gptOss20b, 20.9, { ...input, quant: "BF16" }));
  assert.equal(bestFit(gptOss20b, 20.9, roomy)?.quant, "MXFP4");
  // Its native quant is allowed below the lowest quant asked for.
  assert.equal(bestFit(gptOss20b, 20.9, { ...roomy, minQuant: "Q8_0" })?.quant, "MXFP4");
  // 14 GB: MXFP4 (13.3 GiB) fits, Q4_K_M (14.8 GiB) doesn't.
  assert.equal(
    bestFit(gptOss20b, 20.9, { ...roomy, vramGb: 14, minQuant: "Q4_K_M" })?.quant,
    "MXFP4",
  );
  // Other quants below the floor stay out.
  assert.equal(bestFit(gptOss20b, 20.9, { ...roomy, vramGb: 12, minQuant: "Q4_K_M" }), undefined);
  // Real gpt-oss-20b GGUFs: the experts stay MXFP4 in all of them, so Q4_K_M's
  // file is smaller than MXFP4's. Fewer bits per weight still wins.
  const realSizes = {
    ...gptOss20b,
    gguf: {
      BF16: { bytes: 13.79e9, repo: "x" },
      MXFP4: { bytes: 12.11e9, repo: "x" },
      Q4_K_M: { bytes: 11.67e9, repo: "x" },
    },
  };
  assert.equal(bestFit(realSizes, 20.9, roomy)?.quant, "MXFP4");
});

test("quants below the floor are not offered", () => {
  const small = { ...fit, vramGb: 16 };
  assert.equal(bestFit(gemma3_27b, 27.4, small), undefined);
  assert.equal(bestFit(gemma3_27b, 27.4, { ...small, minQuant: "IQ2_M" })?.quant, "IQ3_M");
});

test("a MoE model that only fits with its experts in RAM says so", () => {
  const moe = { ...qwen3_32b, expertShare: 0.9 };
  // 8k context: 2 GiB of cache, plus the 10% of the weights outside the experts.
  const tight = { ...fit, vramGb: 8, ramGb: 32, contextTokens: 8192 };
  const best = bestFit(moe, 32.8, tight);
  assert.equal(best?.expertsInRam, true);
  assert.equal(bestFit(moe, 32.8, { ...tight, ramGb: 0 }), undefined);
});

test("a context longer than the model's isn't a fit", () => {
  assert.equal(bestFit(qwen3_32b, 32.8, { ...fit, vramGb: 80, contextTokens: 131072 }), undefined);
});

test("sending images loads the image projector, which can cost a quant", () => {
  const vision = { ...gemma3_27b, mmprojBytes: 1.5 * GiB };
  const tight = { ...fit, vramGb: 23 };
  assert.equal(bestFit(vision, 27.4, tight)?.quant, "Q5_K_M");
  const best = bestFit(vision, 27.4, { ...tight, includeVision: true });
  assert.equal(best?.quant, "Q4_K_M");
  assert.equal(best?.estimate.withVision, true);
  const plain = estimateVram(vision, 27.4, input);
  assert.equal(best?.estimate.vram, (plain?.vram ?? 0) + 1.5 * GiB);
});

test("a model without an image projector does not fit for images", () => {
  assert.ok(bestFit(gemma3_27b, 27.4, fit));
  assert.equal(bestFit(gemma3_27b, 27.4, { ...fit, includeVision: true }), undefined);
});

test("the image projector spills to RAM like layers do", () => {
  const vision = { ...dense8b, mmprojBytes: 0.8 * GiB };
  const scenario = {
    ...fit,
    vramGb: 3.8,
    ramGb: 10,
    contextTokens: 500,
    allowLayerOffload: true,
  };
  const plain = bestFit(vision, 8, scenario);
  const best = bestFit(vision, 8, { ...scenario, includeVision: true });
  assert.ok(plain && best);
  assert.ok(best.estimate.vram <= 3.8 * GiB);
  assert.equal(best.quant, plain.quant);
  assert.ok(Math.abs(best.estimate.layersInRam - plain.estimate.layersInRam - 0.8 * GiB) < 1);
});

test("quality is nearly flat down to 4 bits, then falls fast", () => {
  const q = (quant: string) => quantQuality(quant, 35);
  assert.ok(q("Q4_K_M") > 0.99);
  assert.ok(q("Q3_K_M") > 0.9);
  assert.ok(q("Q2_K") < 0.7); // barely useful
  assert.ok(q("IQ2_XXS") < 0.3);
  // Not linear: Q2_K has 8x Q4_K_M's divergence but loses far more than 8x.
  const lost = (quant: string) => 1 - q(quant);
  assert.ok(lost("Q2_K") / lost("Q4_K_M") > 5 * (0.15 / 0.0182));
});

test("the curve shape matches the Gemma 3 27B MMLU ladder it comes from", () => {
  // 1 / (1 + (KL / 1.16)^2) on raw MMLU; IQ2_XXS measured KL 0.52, kept 82.8%.
  assert.ok(Math.abs(1 / (1 + (0.521 / 1.16) ** 2) - 0.828) < 0.01);
});

test("small models lose more at the same quant", () => {
  const q = (params: number) => quantQuality("Q3_K_M", params);
  assert.ok(q(1.5) < q(8));
  assert.ok(q(8) < q(400));
});

test("a model shipped in MXFP4 loses nothing at MXFP4 or above", () => {
  assert.equal(quantQuality("MXFP4", 117, 4.25), 1);
  assert.equal(quantQuality("Q8_0", 117, 4.25), 1);
  assert.ok(quantQuality("Q3_K_M", 117, 4.25) < 1);
});

test("a Mac lets the GPU use 2/3 of its memory up to 36 GB, 3/4 above", () => {
  assert.equal(macGpuMemoryGb(36), 24);
  assert.ok(Math.abs(macGpuMemoryGb(16) - 10.67) < 0.01);
  assert.equal(macGpuMemoryGb(48), 36);
  assert.equal(macGpuMemoryGb(128), 96);
});

test("sizes show in GB as GPU memory is labeled", () => {
  assert.equal(gb(8 * GiB), "8.0 GB");
  assert.equal(gb(24 * GiB), "24 GB");
});
