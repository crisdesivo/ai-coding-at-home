// Copied from localllmpicker (src/shared/memory.ts, generated there by collector/memory.py from
// each model's config.json and GGUF repos): the memory layout of the models in this app's catalog.
// The `gguf` sizes listed here are localllmpicker's; the app replaces them with the sizes of the
// files it actually downloads (catalog-files.ts) before estimating.
export type AttentionDesign = "gqa" | "sliding" | "linear" | "mamba" | "mla" | "other";

export type ModelMemory = {
  design: AttentionDesign;
  /** false when the formula for this design isn't checked against a real run: a best guess. */
  verified: boolean;
  /** KV cache bytes per token of context at 16 bits, in layers whose cache grows with context. */
  kvPerToken: number;
  /** KV cache bytes per token at 16 bits in sliding-window layers, which keep slidingTokens tokens. */
  slidingPerToken: number;
  slidingTokens: number;
  /** Recurrent state that doesn't grow with context (linear attention, Mamba), bytes. */
  stateBytes: number;
  note: string | null;
  maxContext: number | null;
  vocab: number;
  /** Share of the weights in MoE experts: 0 for dense models, null when unknown. */
  expertShare: number | null;
  /** Share of the routed experts each token uses (8 of 256: 0.031), null for dense or unknown. */
  expertsUsed: number | null;
  /** Bits per weight the model ships in (16, or 8 for FP8, 4.25 for MXFP4/INT4). */
  nativeBits: number;
  /** Real GGUF weight size per quant, and the repo it was read from. */
  gguf: Record<string, { bytes: number; repo: string }>;
  /** Vision projector (mmproj) size, for vision models. */
  mmprojBytes: number | null;
};

export const ModelMemories: Record<string, ModelMemory> = {
  "Qwen/Qwen3-Coder-Next": {
    design: "linear",
    verified: true,
    kvPerToken: 24576,
    slidingPerToken: 0,
    slidingTokens: 0,
    stateBytes: 75497472,
    note: null,
    maxContext: 262144,
    vocab: 151936,
    expertShare: 0.97,
    expertsUsed: 0.0195,
    nativeBits: 16,
    gguf: {
      IQ1_M: {
        bytes: 17302421184,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ1_S: {
        bytes: 16582639296,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ2_M: {
        bytes: 26098611904,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ2_S: {
        bytes: 23368906432,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ2_XS: {
        bytes: 22217424576,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ2_XXS: {
        bytes: 19298975424,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ3_M: {
        bytes: 36643917504,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ3_XS: {
        bytes: 33031048896,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ3_XXS: {
        bytes: 31726712512,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ4_NL: {
        bytes: 45310830272,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      IQ4_XS: {
        bytes: 42848224960,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q2_K: {
        bytes: 28167608000,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q2_K_L: {
        bytes: 28471480000,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q3_K_L: {
        bytes: 38227005120,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q3_K_M: {
        bytes: 36655713984,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q3_K_S: {
        bytes: 34864221888,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q4_0: {
        bytes: 46099621568,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q4_1: {
        bytes: 50225817504,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q4_K_L: {
        bytes: 48958623424,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q4_K_M: {
        bytes: 48727680704,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q4_K_S: {
        bytes: 46930880192,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q5_K_L: {
        bytes: 57173102464,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q5_K_M: {
        bytes: 56981055392,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q5_K_S: {
        bytes: 55171278720,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q6_K: {
        bytes: 65791885184,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q6_K_L: {
        bytes: 65942605728,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      Q8_0: {
        bytes: 84812255232,
        repo: "bartowski/Qwen_Qwen3-Coder-Next-GGUF",
      },
      BF16: {
        bytes: 159458415168,
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
      },
    },
    mmprojBytes: null,
  },
  "Qwen/Qwen3.6-27B": {
    design: "linear",
    verified: true,
    kvPerToken: 65536,
    slidingPerToken: 0,
    slidingTokens: 0,
    stateBytes: 150994944,
    note: null,
    maxContext: 262144,
    vocab: 248320,
    expertShare: 0,
    expertsUsed: null,
    nativeBits: 16,
    gguf: {
      IQ2_M: {
        bytes: 11085693440,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ2_S: {
        bytes: 10507665920,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ2_XS: {
        bytes: 10199134720,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ2_XXS: {
        bytes: 9605378560,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ3_M: {
        bytes: 14115852800,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ3_XS: {
        bytes: 13542740480,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ3_XXS: {
        bytes: 12839109120,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ4_NL: {
        bytes: 16538165760,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      IQ4_XS: {
        bytes: 15780160000,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q2_K: {
        bytes: 12051776000,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q2_K_L: {
        bytes: 13293376000,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q3_K_L: {
        bytes: 15491781120,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q3_K_M: {
        bytes: 14818071040,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q3_K_S: {
        bytes: 13932679680,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q4_0: {
        bytes: 16561103360,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q4_1: {
        bytes: 18037793280,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q4_K_L: {
        bytes: 18928488960,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q4_K_M: {
        bytes: 17984872960,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q4_K_S: {
        bytes: 16925483520,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q5_K_L: {
        bytes: 21749813760,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q5_K_M: {
        bytes: 20965122560,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q5_K_S: {
        bytes: 19893281280,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q6_K: {
        bytes: 23675466240,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q6_K_L: {
        bytes: 24291299840,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      Q8_0: {
        bytes: 29116387840,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
      BF16: {
        bytes: 54657733056,
        repo: "bartowski/Qwen_Qwen3.6-27B-GGUF",
      },
    },
    mmprojBytes: 927607360,
  },
  "Qwen/Qwen3.6-35B-A3B": {
    design: "linear",
    verified: true,
    kvPerToken: 20480,
    slidingPerToken: 0,
    slidingTokens: 0,
    stateBytes: 62914560,
    note: null,
    maxContext: 262144,
    vocab: 248320,
    expertShare: 0.895,
    expertsUsed: 0.0312,
    nativeBits: 16,
    gguf: {
      IQ1_M: {
        bytes: 9421649536,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ2_M: {
        bytes: 12964402816,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ2_S: {
        bytes: 11907962496,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ2_XS: {
        bytes: 11694831232,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ2_XXS: {
        bytes: 10676139648,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ3_M: {
        bytes: 17791661696,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ3_XS: {
        bytes: 17110087296,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ3_XXS: {
        bytes: 15761446528,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ4_NL: {
        bytes: 20754978432,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      IQ4_XS: {
        bytes: 19699553920,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q2_K: {
        bytes: 13506778752,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q2_K_L: {
        bytes: 14003418752,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q3_K_L: {
        bytes: 17777899136,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q3_K_M: {
        bytes: 17117951616,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q3_K_S: {
        bytes: 16404919936,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q4_0: {
        bytes: 20836243072,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q4_1: {
        bytes: 22868448896,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q4_K_L: {
        bytes: 22662526592,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q4_K_M: {
        bytes: 22285080192,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q4_K_S: {
        bytes: 21486360192,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q5_K_L: {
        bytes: 26227062400,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q5_K_M: {
        bytes: 25913185920,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q5_K_S: {
        bytes: 25051879040,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q6_K: {
        bytes: 30947309184,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q6_K_L: {
        bytes: 31193642624,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      Q8_0: {
        bytes: 37812647552,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
      BF16: {
        bytes: 71065941536,
        repo: "bartowski/Qwen_Qwen3.6-35B-A3B-GGUF",
      },
    },
    mmprojBytes: 899283680,
  },
  "openai/gpt-oss-20b": {
    design: "sliding",
    verified: true,
    kvPerToken: 24576,
    slidingPerToken: 24576,
    slidingTokens: 768,
    stateBytes: 0,
    note: null,
    maxContext: 131072,
    vocab: 201088,
    expertShare: 0.914,
    expertsUsed: 0.125,
    nativeBits: 4.25,
    gguf: {
      IQ2_M: {
        bytes: 11545731136,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ2_S: {
        bytes: 11545731136,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ2_XS: {
        bytes: 11510341696,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ2_XXS: {
        bytes: 11510341696,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ3_M: {
        bytes: 11559002176,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ3_XS: {
        bytes: 11559002176,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ3_XXS: {
        bytes: 11559002176,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ4_NL: {
        bytes: 11561214016,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      IQ4_XS: {
        bytes: 11561214016,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      MXFP4: {
        bytes: 12109565760,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q2_K: {
        bytes: 11559002176,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q2_K_L: {
        bytes: 11848568896,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q3_K_L: {
        bytes: 11488223296,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q3_K_M: {
        bytes: 11559186496,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q3_K_S: {
        bytes: 11554578496,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q4_0: {
        bytes: 11519189056,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q4_1: {
        bytes: 11592986176,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q4_K_L: {
        bytes: 11890593856,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q4_K_M: {
        bytes: 11673418816,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q4_K_S: {
        bytes: 11667151936,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q5_K_L: {
        bytes: 11909394496,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q5_K_M: {
        bytes: 11728415296,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q5_K_S: {
        bytes: 11722885696,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q6_K: {
        bytes: 12040998976,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q6_K_L: {
        bytes: 12040998976,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      Q8_0: {
        bytes: 12109566016,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      BF16: {
        bytes: 13792637760,
        repo: "bartowski/openai_gpt-oss-20b-GGUF",
      },
      F16: {
        bytes: 13792639168,
        repo: "unsloth/gpt-oss-20b-GGUF",
      },
    },
    mmprojBytes: null,
  },
  "Qwen/Qwen3.5-9B": {
    design: "linear",
    verified: true,
    kvPerToken: 32768,
    slidingPerToken: 0,
    slidingTokens: 0,
    stateBytes: 50331648,
    note: null,
    maxContext: 262144,
    vocab: 248320,
    expertShare: 0,
    expertsUsed: null,
    nativeBits: 16,
    gguf: {
      IQ2_M: {
        bytes: 4027985952,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      IQ2_S: {
        bytes: 3480626272,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      IQ3_M: {
        bytes: 4981092384,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      IQ3_XS: {
        bytes: 4819087392,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      IQ3_XXS: {
        bytes: 4534579232,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      IQ4_NL: {
        bytes: 5737459744,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      IQ4_XS: {
        bytes: 5501202464,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q2_K: {
        bytes: 4322832416,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q2_K_L: {
        bytes: 5316112416,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q3_K_L: {
        bytes: 5369589792,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q3_K_M: {
        bytes: 5178748960,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q3_K_S: {
        bytes: 4927877152,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q4_0: {
        bytes: 5741391904,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q4_1: {
        bytes: 6203420704,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q4_K_L: {
        bytes: 6924234784,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q4_K_M: {
        bytes: 6169341984,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q4_K_S: {
        bytes: 5856735264,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q5_K_L: {
        bytes: 7739240480,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q5_K_M: {
        bytes: 7111487520,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q5_K_S: {
        bytes: 6784987168,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q6_K: {
        bytes: 7958818848,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q6_K_L: {
        bytes: 8451485728,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      Q8_0: {
        bytes: 9804541984,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
      BF16: {
        bytes: 18407321344,
        repo: "bartowski/Qwen_Qwen3.5-9B-GGUF",
      },
    },
    mmprojBytes: 918166080,
  },
  "openbmb/MiniCPM5-2B": {
    design: "gqa",
    verified: true,
    kvPerToken: 43008,
    slidingPerToken: 0,
    slidingTokens: 0,
    stateBytes: 0,
    note: null,
    maxContext: 131072,
    vocab: 130560,
    expertShare: 0,
    expertsUsed: null,
    nativeBits: 16,
    gguf: {
      F16: {
        bytes: 5039006688,
        repo: "openbmb/MiniCPM5-2B-GGUF",
      },
      Q4_K_M: {
        bytes: 1561318368,
        repo: "openbmb/MiniCPM5-2B-GGUF",
      },
      Q8_0: {
        bytes: 2679710688,
        repo: "openbmb/MiniCPM5-2B-GGUF",
      },
    },
    mmprojBytes: null,
  },
};
