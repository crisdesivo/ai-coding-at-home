import type {
  SessionTranscriptCard,
  SessionTranscriptCustomMessage,
  SessionTranscriptMessage,
  SessionTranscriptPin,
  SessionTranscriptRole,
} from "@pi-gui/session-driver";
import type { TurnChangeSummary } from "./review";

export type SessionRole = SessionTranscriptRole;
export type TimelineTone = "neutral" | "success" | "warning" | "error";
export type TimelineToolStatus = "running" | "success" | "error";
export type TimelineSummaryPresentation = "inline" | "divider";

/**
 * Why a turn ended without a usable reply. The renderer words it for people who are not
 * developers and offers what to do next; the activity's `label` keeps the technical message.
 */
export type TimelineRunFailureKind =
  /** The conversation filled the model's context: no room was left to answer. */
  | "out-of-room"
  /** Summarizing older messages to make room failed. */
  | "compaction-failed"
  /** The turn ended with nothing to show: no text and no tool call. */
  | "no-reply"
  /** The local model's server did not answer. */
  | "unreachable"
  /** Any other error the model reported. */
  | "model-error";

export interface TimelineActivity {
  readonly kind: "activity";
  readonly id: string;
  readonly createdAt: string;
  readonly label: string;
  readonly detail?: string;
  readonly metadata?: string;
  readonly tone?: TimelineTone;
  /** Set on the row for a turn that ended without a usable reply. */
  readonly failure?: TimelineRunFailureKind;
}

export interface TimelineToolCall {
  readonly kind: "tool";
  readonly id: string;
  readonly callId: string;
  readonly toolName: string;
  readonly status: TimelineToolStatus;
  readonly label: string;
  readonly detail?: string;
  readonly metadata?: string;
  readonly createdAt: string;
  readonly input?: unknown;
  readonly output?: unknown;
}

export interface TimelineSummary {
  readonly kind: "summary";
  readonly id: string;
  readonly createdAt: string;
  readonly label: string;
  readonly metadata?: string;
  readonly presentation: TimelineSummaryPresentation;
  /**
   * pi is summarizing the messages before this point to make room (`running`, shown in place
   * of the working line), or did (`done`).
   */
  readonly compaction?: "running" | "done";
}

export type TranscriptMessage =
  | SessionTranscriptMessage
  | SessionTranscriptCustomMessage
  | SessionTranscriptCard
  | SessionTranscriptPin
  | TimelineActivity
  | TimelineToolCall
  | TimelineSummary;

/**
 * What the conversation timeline draws: the transcript without its pins, which show above the
 * composer. The renderer splits them off once, so a pin reaching the timeline fails typecheck.
 */
export type TimelineTranscriptItem = Exclude<TranscriptMessage, SessionTranscriptPin>;

/**
 * A derived, view-only marker inserted between turns to show how long the agent
 * worked on the preceding user prompt. Never persisted or produced by the store;
 * the timeline computes it from real message/tool timestamps at render time, so
 * it is kept out of {@link TranscriptMessage} to avoid leaking into store code.
 */
export interface TimelineTurnMarker {
  readonly kind: "turn-marker";
  readonly id: string;
  readonly durationMs: number;
}

/** A derived, view-only card listing the files one captured turn changed, placed after that turn. */
export interface TimelineTurnChanges {
  readonly kind: "turn-changes";
  readonly id: string;
  readonly turn: TurnChangeSummary;
}

/**
 * A derived, view-only "Working" line kept at the bottom of the turn that is still running, so
 * it stays under the latest tool row or reply text. `startedAt` is when the run began.
 */
export interface TimelineWorkingIndicator {
  readonly kind: "working";
  readonly id: "working-indicator";
  readonly startedAt?: string;
}

export type DisplayTimelineItem =
  TimelineTranscriptItem | TimelineTurnMarker | TimelineTurnChanges | TimelineWorkingIndicator;
