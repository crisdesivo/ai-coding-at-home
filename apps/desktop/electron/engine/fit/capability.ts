// Copied from localllmpicker (src/shared/capability.ts) unchanged apart from formatting and imports.
// Ratings are relative: people rate a model against what they expect from its
// size and from what was out at the time. These factors put them on one scale.
// Method and sources: reports/localllama/quant_quality.md of the income growth
// project.

import type { ModelMemory } from "./memory";

/**
 * A 1 to 5 rating scaled by a share of capability kept: only the part above 1,
 * the bottom of the scale, scales. Keeping everything leaves the rating as is;
 * keeping nothing drops it to 1.
 */
export function scaleRating(rating: number, kept: number): number {
  return 1 + (rating - 1) * kept;
}

/** Size, in billions of active parameters, that counts as full weight. */
export const referenceActiveB = 1000;

/** Assumed active size of models whose size isn't known: mid-size. */
const unknownSizeB = 14;

/** Share of a MoE model's weights in its experts, when its config doesn't say. */
const typicalExpertShare = 0.95;

/**
 * The parameters a model uses per token, in billions: all of a dense model,
 * the active ones of a MoE model. Hugging Face doesn't list the active size of
 * many MoE models (DeepSeek, GLM, gpt-oss…); then it comes from the model's
 * config: the shared weights plus the experts each token uses. Null when the
 * size isn't known.
 */
export function activeParams(
  paramsB: number | null,
  activeParamsB: number | null,
  memory?: Pick<ModelMemory, "expertShare" | "expertsUsed">,
): number | null {
  if (paramsB == null) return activeParamsB;
  if (activeParamsB != null) return Math.min(activeParamsB, paramsB);
  if (memory?.expertsUsed != null) {
    const experts = memory.expertShare || typicalExpertShare;
    return paramsB * (1 - experts + experts * memory.expertsUsed);
  }
  return paramsB;
}

/**
 * Weight of a model's rating, 0 to 1: proportional to the square root of its
 * active parameters, 1 at referenceActiveB (1T) and above. A 4B model weighs
 * half as much as a 16B one.
 */
export function sizeKept(
  paramsB: number | null,
  activeParamsB: number | null = null,
  memory?: Pick<ModelMemory, "expertShare" | "expertsUsed">,
): number {
  const size = activeParams(paramsB, activeParamsB, memory) ?? unknownSizeB;
  return Math.min(1, Math.sqrt(size / referenceActiveB));
}
