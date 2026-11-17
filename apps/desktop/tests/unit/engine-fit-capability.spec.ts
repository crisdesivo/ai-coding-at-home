// Copied from localllmpicker (src/shared/capability.test.ts), run with Playwright's runner instead of node:test.
import assert from "node:assert/strict";
import { test } from "@playwright/test";
import { activeParams, scaleRating, sizeKept } from "../../electron/engine/fit/capability";

test("a rating scales only the part above 1", () => {
  assert.equal(scaleRating(4, 1), 4);
  assert.equal(scaleRating(4, 0), 1);
  assert.equal(scaleRating(4, 0.5), 2.5);
});

test("size weight is proportional to the square root of active parameters", () => {
  assert.ok(Math.abs(sizeKept(16) / sizeKept(4) - 2) < 1e-9);
  assert.equal(sizeKept(1000), 1);
  assert.equal(sizeKept(2000), 1);
  assert.ok(Math.abs(sizeKept(250) - 0.5) < 1e-9);
});

test("a MoE model counts its active parameters only", () => {
  assert.equal(activeParams(30, 3), 3);
  assert.equal(sizeKept(30, 3), sizeKept(3));
  assert.equal(activeParams(32, 32), 32);
  assert.equal(activeParams(32, null), 32);
});

test("a MoE model without a listed active size gets it from its config", () => {
  // 96% of the weights in experts, 1 in 32 used per token.
  const active = activeParams(600, null, {
    expertShare: 0.96,
    expertsUsed: 1 / 32,
  });
  assert.ok(active != null && Math.abs(active - 600 * (0.04 + 0.03)) < 0.01);
  // No expert share known: a typical 95%.
  const guessed = activeParams(1000, null, {
    expertShare: null,
    expertsUsed: 0.02,
  });
  assert.ok(guessed != null && Math.abs(guessed - 1000 * (0.05 + 0.019)) < 0.01);
});

test("a small model rated as well as a big one ends up lower", () => {
  const small = scaleRating(3.6, sizeKept(0.8));
  const big = scaleRating(3.6, sizeKept(27));
  assert.ok(big > small);
});
