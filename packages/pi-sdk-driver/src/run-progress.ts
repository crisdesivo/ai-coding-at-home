import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { RunProgress, RunProgressActivity } from "@pi-gui/session-driver";

/** At most four progress events per second per session. */
export const RUN_PROGRESS_INTERVAL_MS = 250;

/** Longest bash command text a progress event carries; the UI shortens it further. */
const COMMAND_DETAIL_MAX_LENGTH = 200;

const FILE_TOOLS = new Set(["write", "edit"]);
const READ_TOOLS = new Set(["read"]);

type ToolCallBlockLike = {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly arguments?: unknown;
};
type PartialMessageLike = {
  readonly content?: readonly unknown[];
  readonly usage?: { readonly output?: unknown };
};

type Phase =
  | { readonly kind: "waiting" }
  | { readonly kind: "thinking" }
  | { readonly kind: "replying" }
  /** The live partial message; its tool call grows while arguments stream. */
  | {
      readonly kind: "toolCall";
      readonly partial: PartialMessageLike;
      readonly contentIndex: number;
    }
  | { readonly kind: "runningTool"; readonly toolName: string; readonly args: unknown };

/**
 * Follows one run's streaming events and summarizes them as {@link RunProgress}:
 * what the model is doing, how many tokens this step produced and how fast.
 * A step is one model reply or one tool execution. Pure: callers pass the clock.
 */
export class RunProgressTracker {
  private phase: Phase = { kind: "waiting" };
  private stepStartedAt: number;
  private stepDeltas = 0;
  private stepProviderTokens = 0;
  private firstDeltaAt: number | undefined;
  private lastDeltaAt: number | undefined;
  private lastOutputAt: number | undefined;
  private lastEmittedAt = Number.NEGATIVE_INFINITY;
  /** Tools executing now, newest last; pi can run several at once. */
  private readonly runningTools = new Map<string, { toolName: string; args: unknown }>();

  constructor(now: number) {
    this.stepStartedAt = now;
  }

  /** A model reply begins: the model reads the prompt before its first token. */
  startReply(now: number): void {
    this.phase = { kind: "waiting" };
    this.resetStep(now);
  }

  /** One streamed assistant event (`message_update`). */
  recordAssistantEvent(event: AssistantMessageEvent, now: number): void {
    switch (event.type) {
      case "thinking_start":
        this.phase = { kind: "thinking" };
        break;
      case "thinking_delta":
        this.phase = { kind: "thinking" };
        this.countDelta(now);
        break;
      case "text_start":
        this.phase = { kind: "replying" };
        break;
      case "text_delta":
        this.phase = { kind: "replying" };
        this.countDelta(now);
        break;
      case "toolcall_start":
      case "toolcall_end":
        this.phase = { kind: "toolCall", partial: event.partial, contentIndex: event.contentIndex };
        break;
      case "toolcall_delta":
        this.phase = { kind: "toolCall", partial: event.partial, contentIndex: event.contentIndex };
        this.countDelta(now);
        break;
      default:
        break;
    }
    const partial =
      "partial" in event ? event.partial : "message" in event ? event.message : undefined;
    const reported = (partial as PartialMessageLike | undefined)?.usage?.output;
    if (typeof reported === "number" && reported > this.stepProviderTokens) {
      this.stepProviderTokens = reported;
    }
  }

  /** `tool_execution_start`: a new step that produces no tokens. */
  startTool(callId: string, toolName: string, args: unknown, now: number): void {
    this.runningTools.set(callId, { toolName, args });
    this.phase = { kind: "runningTool", toolName, args };
    this.resetStep(now);
  }

  /** `tool_execution_end`: once no tool runs, the model is asked to continue. */
  endTool(callId: string, now: number): void {
    this.runningTools.delete(callId);
    const newest = [...this.runningTools.values()].at(-1);
    if (newest) {
      this.phase = { kind: "runningTool", toolName: newest.toolName, args: newest.args };
      return;
    }
    this.phase = { kind: "waiting" };
    this.resetStep(now);
  }

  snapshot(): RunProgress {
    const stepTokens = Math.max(this.stepDeltas, this.stepProviderTokens);
    const spanMs =
      this.firstDeltaAt !== undefined && this.lastDeltaAt !== undefined
        ? this.lastDeltaAt - this.firstDeltaAt
        : 0;
    const tokensPerSecond =
      this.stepDeltas >= 2 && spanMs > 0
        ? Math.round(((this.stepDeltas - 1) / (spanMs / 1000)) * 10) / 10
        : undefined;
    return {
      activity: this.activity(),
      stepStartedAt: new Date(this.stepStartedAt).toISOString(),
      stepTokens,
      ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
      ...(this.lastOutputAt !== undefined
        ? { lastOutputAt: new Date(this.lastOutputAt).toISOString() }
        : {}),
    };
  }

  /** Milliseconds until the throttle lets the next event out; 0 means now. */
  emitDelay(now: number): number {
    return Math.max(0, this.lastEmittedAt + RUN_PROGRESS_INTERVAL_MS - now);
  }

  markEmitted(now: number): void {
    this.lastEmittedAt = now;
  }

  private activity(): RunProgressActivity {
    switch (this.phase.kind) {
      case "waiting":
      case "thinking":
      case "replying":
        return { kind: this.phase.kind };
      case "toolCall": {
        const block = this.phase.partial.content?.[this.phase.contentIndex] as
          ToolCallBlockLike | undefined;
        const toolName = typeof block?.name === "string" ? block.name : "";
        const fileName = streamingToolCallFile(toolName, block?.arguments);
        return fileName
          ? { kind: "writingFile", toolName, fileName }
          : { kind: "writingToolCall", toolName };
      }
      case "runningTool": {
        const detail = runningToolDetail(this.phase.toolName, this.phase.args);
        return {
          kind: "runningTool",
          toolName: this.phase.toolName,
          ...(detail ? { detail } : {}),
        };
      }
    }
  }

  private countDelta(now: number): void {
    this.stepDeltas += 1;
    this.firstDeltaAt ??= now;
    this.lastDeltaAt = now;
    this.lastOutputAt = now;
  }

  private resetStep(now: number): void {
    this.stepStartedAt = now;
    this.stepDeltas = 0;
    this.stepProviderTokens = 0;
    this.firstDeltaAt = undefined;
    this.lastDeltaAt = undefined;
  }
}

function stringArg(args: unknown, name: string): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** The file a streaming tool call writes, when its arguments say so already. */
export function streamingToolCallFile(toolName: string, args: unknown): string | undefined {
  if (FILE_TOOLS.has(toolName)) {
    const path = stringArg(args, "path");
    return path ? fileBaseName(path) : undefined;
  }
  if (toolName === "bash") {
    const command = stringArg(args, "command");
    return command ? heredocTargetFile(command) : undefined;
  }
  return undefined;
}

function runningToolDetail(toolName: string, args: unknown): string | undefined {
  if (toolName === "bash") {
    const command = stringArg(args, "command");
    if (!command) return undefined;
    const firstLine = command.trim().split("\n", 1)[0] ?? "";
    return firstLine.length > COMMAND_DETAIL_MAX_LENGTH
      ? firstLine.slice(0, COMMAND_DETAIL_MAX_LENGTH)
      : firstLine;
  }
  if (FILE_TOOLS.has(toolName) || READ_TOOLS.has(toolName)) {
    const path = stringArg(args, "path");
    return path ? fileBaseName(path) : undefined;
  }
  return undefined;
}

const HEREDOC_MARKER = /<<-?\s*(["']?)[A-Za-z_][\w.-]*\1/;
// `> file`, `>> file`, quoted or not; not `2>`, `&>` or `>&`.
const REDIRECT_TARGET = /(?<![\d&>])>>?(?!&)\s*(?:"([^"]+)"|'([^']+)'|([^\s"'<>|;&()]+))/g;
const TEE_TARGET =
  /\btee\s+(?:-a\s+|--append\s+)?(?:"([^"]+)"|'([^']+)'|([^\s"'<>|;&()-][^\s"'<>|;&()]*))/;

/**
 * The file a bash heredoc writes, read from the command's first line only:
 * `cat > board.js <<'EOF'`, `cat <<EOF >> notes.md`, `tee -a log.txt <<EOF`.
 * Anything else (no heredoc, `python3 - <<EOF`, a redirect to /dev/null) is undefined.
 */
export function heredocTargetFile(command: string): string | undefined {
  const newline = command.indexOf("\n");
  const firstLine = newline === -1 ? command : command.slice(0, newline);
  if (!HEREDOC_MARKER.test(firstLine)) return undefined;
  const line = firstLine.replace(HEREDOC_MARKER, " ");
  for (const match of line.matchAll(REDIRECT_TARGET)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target && target !== "/dev/null") return fileBaseName(target);
  }
  const tee = TEE_TARGET.exec(line);
  const teeTarget = tee ? (tee[1] ?? tee[2] ?? tee[3]) : undefined;
  return teeTarget && teeTarget !== "/dev/null" ? fileBaseName(teeTarget) : undefined;
}

function fileBaseName(path: string): string | undefined {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).at(-1);
  return name ? name : undefined;
}
