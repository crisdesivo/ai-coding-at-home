import { expect, test } from "@playwright/test";
import { BASIC_MODEL_ID, MODEL_CATALOG, catalogModel } from "../../electron/engine/catalog";
import {
  DISK_HEADROOM_BYTES,
  appleGpuShareGb,
  chooseModel,
  downloadKey,
  fitsHardware,
  neededGb,
  quantOptions,
  type ChooseResult,
  type ComputerSpecs,
} from "../../electron/engine/choose";
import { modelMemory } from "../../electron/engine/catalog";
import { quantBits } from "../../electron/engine/fit/vram";

const pc = (vramGb: number, ramGb: number): ComputerSpecs => ({ kind: "pc", vramGb, ramGb });
const mac = (ramGb: number): ComputerSpecs => ({ kind: "mac", vramGb: 0, ramGb });

function picked(result: ChooseResult): string {
  if (result.kind !== "ok") throw new Error(`expected a model, got ${result.kind}`);
  return `${result.choice.model.id} ${result.choice.quant}`;
}

// The user's rule on localllmpicker's estimate at 100k tokens, q8_0 cache: with a GPU, 60% of
// `needed` in VRAM and the rest in RAM − 4 GB; without, needed ≤ 20% of RAM.
const cases: ReadonlyArray<{
  readonly name: string;
  readonly computer: ComputerSpecs;
  readonly expected: string;
  readonly partly?: boolean;
}> = [
  // This PC: RTX 3050 Laptop 4 GB + 38.9 GiB: needed ≤ 6.67 GiB.
  {
    name: "4 GB GPU + 38 GB RAM",
    computer: pc(4, 38.9),
    expected: "minicpm5-2b Q5_K_S",
    partly: true,
  },
  { name: "CPU only, 16 GB RAM (needed ≤ 3.2 GB)", computer: pc(0, 16), expected: "too-small" },
  {
    name: "CPU only, 32 GB RAM (needed ≤ 6.4 GB)",
    computer: pc(0, 32),
    expected: "minicpm5-2b Q5_K_S",
  },
  {
    name: "6 GB GPU + 16 GB RAM",
    computer: pc(6, 16),
    expected: "qwen3.5-9b Q5_K_S",
    partly: true,
  },
  {
    name: "8 GB GPU + 16 GB RAM",
    computer: pc(8, 16),
    expected: "qwen3.5-9b Q5_K_S",
    partly: true,
  },
  {
    name: "12 GB GPU + 32 GB RAM",
    computer: pc(12, 32),
    expected: "qwen3.6-27b IQ4_XS",
    partly: true,
  },
  {
    name: "24 GB GPU + 32 GB RAM",
    computer: pc(24, 32),
    expected: "qwen3.6-27b Q5_K_M",
    partly: false,
  },
  {
    name: "32 GB GPU + 64 GB RAM",
    computer: pc(32, 64),
    expected: "qwen3.6-27b Q6_K",
    partly: false,
  },
  { name: "Mac 8 GB", computer: mac(8), expected: "minicpm5-2b Q6_K", partly: false },
  { name: "Mac 16 GB", computer: mac(16), expected: "qwen3.5-9b Q6_K", partly: false },
  { name: "Mac 24 GB", computer: mac(24), expected: "qwen3.6-27b IQ4_XS", partly: true },
  { name: "Mac 48 GB", computer: mac(48), expected: "qwen3.6-27b Q6_K", partly: false },
  { name: "Mac 128 GB", computer: mac(128), expected: "qwen3.6-27b Q6_K", partly: false },
];

for (const entry of cases) {
  test(`chooses for ${entry.name}`, () => {
    const result = chooseModel({ computer: entry.computer });
    if (entry.expected === "too-small") {
      expect(result.kind).toBe("too-small");
      if (result.kind === "too-small") expect(result.smallest.model.id).toBe(BASIC_MODEL_ID);
      return;
    }
    expect(picked(result)).toBe(entry.expected);
    if (result.kind !== "ok") return;
    expect(result.limitedByDisk).toBe(false);
    expect(result.basic).toBe(result.choice.model.id === BASIC_MODEL_ID);
    if (entry.partly !== undefined) expect(result.choice.partlyInSystemMemory).toBe(entry.partly);
    // Whatever it picks satisfies the rule.
    expect(fitsHardware(result.choice.neededGb, entry.computer)).toBe(true);
  });
}

test("more memory never gives a worse pick: a better model or a higher quant of the same one", () => {
  const ladders: ComputerSpecs[][] = [
    [
      pc(4, 16),
      pc(4, 38.9),
      pc(6, 16),
      pc(8, 16),
      pc(8, 32),
      pc(12, 32),
      pc(16, 32),
      pc(24, 32),
      pc(32, 64),
      pc(48, 128),
    ],
    [pc(0, 32), pc(0, 48), pc(0, 64), pc(0, 128), pc(0, 256)],
    [mac(8), mac(16), mac(24), mac(32), mac(48), mac(64), mac(96), mac(128)],
  ];
  for (const ladder of ladders) {
    let previous: Extract<ChooseResult, { kind: "ok" }> | undefined;
    for (const computer of ladder) {
      const result = chooseModel({ computer });
      if (result.kind !== "ok") continue;
      if (previous) {
        expect(result.choice.score).toBeGreaterThanOrEqual(previous.choice.score - 1e-9);
        if (result.choice.model.id === previous.choice.model.id) {
          const memory = modelMemory(result.choice.model);
          expect(quantBits(result.choice.quant, memory)).toBeGreaterThanOrEqual(
            quantBits(previous.choice.quant, memory),
          );
        }
      }
      previous = result;
    }
  }
});

test("the GPU must hold 60% of what the model needs, and RAM the rest", () => {
  expect(fitsHardware(10, pc(6, 32))).toBe(true);
  expect(fitsHardware(10, pc(5.99, 32))).toBe(false);
  // 20 GiB on 12 GiB: 8 GiB in RAM, which needs 12 GiB RAM (4 kept for the OS).
  expect(fitsHardware(20, pc(12, 12))).toBe(true);
  expect(fitsHardware(20, pc(12, 11.9))).toBe(false);
  // Without a GPU: 20% of RAM.
  expect(fitsHardware(3.2, pc(0, 16))).toBe(true);
  expect(fitsHardware(3.3, pc(0, 16))).toBe(false);
  expect(appleGpuShareGb(24)).toBeCloseTo(16);
  expect(appleGpuShareGb(48)).toBeCloseTo(36);
});

test("every catalog model has its memory layout and checksummed files, and fits 100k tokens", () => {
  for (const model of MODEL_CATALOG) {
    const options = quantOptions(model, pc(0, 16));
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.neededGb).toBeGreaterThan(0);
      for (const file of option.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  }
  // The estimate matches docs/coding-models.md's "All on GPU" at Q4_K_M within a few percent.
  const q4 = (id: string) => {
    const model = catalogModel(id);
    if (!model) throw new Error(id);
    return neededGb(model, "Q4_K_M") ?? 0;
  };
  expect(q4("qwen3.5-9b")).toBeCloseTo(8.1, 0);
  expect(q4("qwen3.6-27b")).toBeCloseTo(20.4, 0);
  expect(q4("minicpm5-2b")).toBeCloseTo(4.4, 0);
});

test("gpt-oss is never offered above its native MXFP4", () => {
  const model = catalogModel("gpt-oss-20b");
  if (!model) throw new Error("missing");
  const quants = quantOptions(model, pc(24, 64)).map((option) => option.quant);
  expect(quants[0]).toBe("MXFP4");
  expect(quants).not.toContain("Q8_0");
  expect(quants).not.toContain("F16");
});

test("a fuller disk gives a lower quant of the same model first", () => {
  const result = chooseModel({ computer: pc(24, 32), diskFreeBytes: 15e9 });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(`${result.hardwarePick.model.id} ${result.hardwarePick.quant}`).toBe("qwen3.6-27b Q5_K_M");
  expect(picked(result)).toBe("qwen3.6-27b Q3_K_S");
  expect(result.limitedByDisk).toBe(true);
});

test("an even fuller disk gives a smaller model", () => {
  const result = chooseModel({ computer: pc(24, 32), diskFreeBytes: 10e9 });
  expect(picked(result)).toBe("qwen3.5-9b Q6_K");
  expect(result.kind === "ok" && result.limitedByDisk).toBe(true);
});

test("counts what is already downloaded, and an installed model needs no space", () => {
  const free = 2.9e9;
  expect(chooseModel({ computer: pc(4, 38.9), diskFreeBytes: free }).kind).toBe("no-disk");
  const resumed = chooseModel({
    computer: pc(4, 38.9),
    diskFreeBytes: free,
    downloadedBytes: { [downloadKey("minicpm5-2b", "Q5_K_S")]: 1e9 },
  });
  expect(picked(resumed)).toBe("minicpm5-2b Q5_K_S");
  const installed = chooseModel({
    computer: pc(4, 38.9),
    diskFreeBytes: 0,
    installed: { modelId: "minicpm5-2b", quant: "Q5_K_S" },
  });
  expect(picked(installed)).toBe("minicpm5-2b Q5_K_S");
});

test("reports how much space is needed when nothing fits on the disk", () => {
  const result = chooseModel({ computer: pc(4, 38.9), diskFreeBytes: 2.9e9 });
  expect(result.kind).toBe("no-disk");
  if (result.kind !== "no-disk") return;
  // The smallest download that fits the hardware: MiniCPM5 2B IQ2_M.
  const smallest = catalogModel(BASIC_MODEL_ID)?.quants.IQ2_M?.[0]?.bytes ?? 0;
  expect(result.neededBytes).toBe(smallest + DISK_HEADROOM_BYTES);
  expect(result.freeBytes).toBe(2.9e9);
});

test("never picks a quant above Q6_K, and the catalog has no bigger files", () => {
  for (const model of MODEL_CATALOG) {
    for (const quant of Object.keys(model.quants)) {
      expect(quantBits(quant, modelMemory(model))).toBeLessThanOrEqual(6.57);
    }
    for (const option of quantOptions(model, pc(96, 256))) {
      expect(["Q8_0", "BF16", "F16"]).not.toContain(option.quant);
    }
  }
  const result = chooseModel({ computer: mac(512) });
  expect(result.kind === "ok" && result.choice.quant).toBe("Q6_K");
});
