import { CATALOG_FILES, type CatalogFile } from "./catalog-files";
import { ModelMemories, type ModelMemory } from "./fit/memory";

export type { CatalogFile } from "./catalog-files";

/**
 * The coding models the app can set up. Each comes in several quants (catalog-files.ts); the app
 * picks the model and the quant together for each computer (choose.ts), the way localllmpicker
 * ranks its picks. One array: changing the catalog is a change here (and in catalog-files.ts).
 */
export interface CatalogModel {
  /** The id llama-server serves the model under (`--alias`) and pi selects. */
  readonly id: string;
  readonly name: string;
  /** Its entry in fit/memory.ts (localllmpicker's model id). */
  readonly memoryKey: string;
  /** Total parameters, billions (localllmpicker's models.ts). */
  readonly paramsB: number;
  readonly activeParamsB: number;
  /**
   * Coding quality: Artificial Analysis Coding Index v4.1.1 (2026-09-09 snapshot), from
   * ai-coding-at-home/model-catalog.md.
   */
  readonly score: number;
  /** pi's `reasoning` flag; for Qwen3.x it also sends `enable_thinking: false`. */
  readonly reasoning: boolean;
  readonly maxTokens: number;
  /** GGUF files per quant (split GGUFs have several parts). */
  readonly quants: Readonly<Record<string, readonly CatalogFile[]>>;
}

/** The context every model is started with: coding needs ~100k tokens. */
export const CONTEXT_TOKENS = 102_400;
/** KV cache type (`-ctk q8_0 -ctv q8_0`). */
export const KV_CACHE = "q8_0" as const;
/** The fewest-bits quant considered, as localllmpicker's recommendations. */
export const MIN_QUANT = "IQ2_XXS";
/**
 * The most bits a quant may have (the user's decision): above Q6_K the files only cost memory and
 * speed for a difference too small to matter. Models shipped in fewer bits (gpt-oss in MXFP4) keep
 * their native precision as the cap.
 */
export const MAX_QUANT = "Q6_K";

function files(id: string): Readonly<Record<string, readonly CatalogFile[]>> {
  const entry = CATALOG_FILES[id];
  if (!entry) throw new Error(`No files listed for ${id}`);
  return entry;
}

export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    id: "qwen3-coder-next",
    name: "Qwen3-Coder-Next",
    memoryKey: "Qwen/Qwen3-Coder-Next",
    paramsB: 79.7,
    activeParamsB: 3,
    score: 36.2,
    reasoning: false,
    maxTokens: 8192,
    quants: files("qwen3-coder-next"),
  },
  {
    id: "qwen3.6-27b",
    name: "Qwen3.6 27B",
    memoryKey: "Qwen/Qwen3.6-27B",
    paramsB: 27.8,
    activeParamsB: 27.8,
    score: 53.7,
    reasoning: false,
    maxTokens: 8192,
    quants: files("qwen3.6-27b"),
  },
  {
    id: "qwen3.6-35b-a3b",
    name: "Qwen3.6 35B-A3B",
    memoryKey: "Qwen/Qwen3.6-35B-A3B",
    paramsB: 36,
    activeParamsB: 3,
    score: 41.9,
    reasoning: false,
    maxTokens: 8192,
    quants: files("qwen3.6-35b-a3b"),
  },
  {
    id: "gpt-oss-20b",
    name: "gpt-oss 20B",
    memoryKey: "openai/gpt-oss-20b",
    paramsB: 20.9,
    activeParamsB: 3.6,
    score: 20.7,
    // gpt-oss always reasons; llama.cpp returns it separately and pi shows it as thinking.
    reasoning: true,
    maxTokens: 12_800,
    quants: files("gpt-oss-20b"),
  },
  {
    id: "qwen3.5-9b",
    name: "Qwen3.5 9B",
    memoryKey: "Qwen/Qwen3.5-9B",
    paramsB: 9.7,
    activeParamsB: 9.7,
    score: 28.7,
    reasoning: false,
    maxTokens: 8192,
    quants: files("qwen3.5-9b"),
  },
  {
    id: "minicpm5-2b",
    name: "MiniCPM5 2B",
    memoryKey: "openbmb/MiniCPM5-2B",
    paramsB: 2.5,
    activeParamsB: 2.5,
    score: 14.5,
    reasoning: false,
    maxTokens: 8192,
    quants: files("minicpm5-2b"),
  },
];

/** The smallest model: what a computer below the recommendations can still try. */
export const BASIC_MODEL_ID = "minicpm5-2b";

export function catalogModel(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
}

export function fileUrl(file: Pick<CatalogFile, "repo" | "file">): string {
  return `https://huggingface.co/${file.repo}/resolve/main/${file.file}`;
}

export function totalBytes(parts: readonly Pick<CatalogFile, "bytes">[]): number {
  return parts.reduce((sum, part) => sum + part.bytes, 0);
}

/** localllmpicker's memory layout of the model, with the sizes of the files this app downloads. */
export function modelMemory(model: CatalogModel): ModelMemory {
  const memory = ModelMemories[model.memoryKey];
  if (!memory) throw new Error(`No memory layout for ${model.memoryKey}`);
  const gguf: ModelMemory["gguf"] = {};
  for (const [quant, parts] of Object.entries(model.quants)) {
    const first = parts[0];
    if (first) gguf[quant] = { bytes: totalBytes(parts), repo: first.repo };
  }
  return { ...memory, gguf };
}

/** "11.6 GB" — decimal gigabytes, the way download sizes are usually shown. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(1)} GB`;
  }
  if (bytes >= 1e6) {
    return `${Math.round(bytes / 1e6)} MB`;
  }
  if (bytes >= 1e3) {
    return `${Math.round(bytes / 1e3)} KB`;
  }
  return `${bytes} bytes`;
}
