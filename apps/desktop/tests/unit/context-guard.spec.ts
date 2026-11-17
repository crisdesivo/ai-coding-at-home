import { expect, test } from "@playwright/test";
import { budgetChars, shorten } from "../../resources/extensions/context-guard/index.ts";

test("tool output budget is about 15% of the local model's context window", () => {
  expect(budgetChars(16384)).toBe(Math.floor(16384 * 0.15 * 3.5));
  expect(budgetChars(undefined)).toBe(budgetChars(16384));
  expect(budgetChars(1000)).toBe(2000);
});

test("long output keeps its start and end, with a note about what was left out", () => {
  const text = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
  const short = shorten(text, 1000);
  expect(short.length).toBeLessThan(1300);
  expect(short.startsWith("line 0\n")).toBe(true);
  expect(short.endsWith("line 1999")).toBe(true);
  expect(short).toContain("left out to fit the local model's memory");
  expect(shorten("short", 1000)).toBe("short");
});
