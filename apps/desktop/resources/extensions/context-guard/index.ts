/**
 * pi at home: a local model's context window is small (16k tokens is common), and pi keeps up
 * to 50 KB of a tool's output (about 12k tokens), so one `git diff` or long log can fill the
 * whole window and leave the model no room to answer. This shortens each tool result to about
 * 15% of the context window, keeping its start and end.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SHARE_OF_CONTEXT = 0.15;
const CHARS_PER_TOKEN = 3.5;
const MIN_CHARS = 2000;
const DEFAULT_CONTEXT_TOKENS = 16384;

export function budgetChars(contextTokens: number | undefined): number {
  const tokens = contextTokens && contextTokens > 0 ? contextTokens : DEFAULT_CONTEXT_TOKENS;
  return Math.max(MIN_CHARS, Math.floor(tokens * SHARE_OF_CONTEXT * CHARS_PER_TOKEN));
}

/** The text cut to `budget` characters: its first 60% and last 40%, with a note in between. */
export function shorten(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = text.slice(0, Math.floor(budget * 0.6));
  const tail = text.slice(text.length - Math.floor(budget * 0.4));
  const omitted = text.slice(head.length, text.length - tail.length);
  const lines = omitted.split("\n").length - 1;
  return `${head}\n\n[… ${lines} lines (${omitted.length} characters) left out to fit the local model's memory. Ask for a narrower command, like a single file or fewer lines, to see them …]\n\n${tail}`;
}

export default function contextGuard(pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    const budget = budgetChars(ctx.model?.contextWindow);
    let changed = false;
    const content = event.content.map((part) => {
      if (part.type !== "text" || part.text.length <= budget) return part;
      changed = true;
      return { ...part, text: shorten(part.text, budget) };
    });
    return changed ? { content } : undefined;
  });
}
