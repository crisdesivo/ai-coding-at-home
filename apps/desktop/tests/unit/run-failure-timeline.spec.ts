import { expect, test } from "@playwright/test";
import { sessionKey, type SessionDriverEvent } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "../../contracts/timeline-types";
import { applyTimelineEvent, runFailureKind } from "../../electron/conversation/app-store-timeline";
import { buildDisplayTimelineItems } from "../../src/features/conversation/timeline-turns";

const sessionRef = { workspaceId: "workspace", sessionId: "session" };
const key = sessionKey(sessionRef);
const timestamp = "2026-11-16T10:00:00.000Z";

function harness() {
  const transcripts = new Map<string, readonly TranscriptMessage[]>([
    [
      key,
      [{ kind: "message", id: "u1", role: "user", text: "Explain this", createdAt: timestamp }],
    ],
  ]);
  const state: Parameters<typeof applyTimelineEvent>[2] = {
    activeAssistantMessageBySession: new Map(),
    pendingAssistantMessageBySession: new Map(),
    extensionToolLabels: () => new Map(),
    runningSinceBySession: new Map(),
    runMetricsBySession: new Map(),
  };
  return {
    apply: (event: SessionDriverEvent) => applyTimelineEvent(transcripts, event, state),
    transcript: () => transcripts.get(key) ?? [],
  };
}

test("each way a run fails becomes a failure row the card can word", () => {
  expect(runFailureKind({ message: "x", code: "OUT_OF_ROOM" })).toBe("out-of-room");
  expect(runFailureKind({ message: "x", code: "COMPACTION_FAILED" })).toBe("compaction-failed");
  expect(runFailureKind({ message: "x", code: "NO_REPLY" })).toBe("no-reply");
  expect(
    runFailureKind({
      message: "400 the request exceeds the available context size, try increasing it",
      code: "ERROR",
    }),
  ).toBe("out-of-room");
  expect(runFailureKind({ message: "Connection error.", code: "ERROR" })).toBe("unreachable");
  expect(runFailureKind({ message: "500 Internal Server Error", code: "ERROR" })).toBe(
    "model-error",
  );

  const { apply, transcript } = harness();
  apply({
    type: "runFailed",
    sessionRef,
    timestamp,
    error: { message: "Context overflow recovery failed: boom", code: "COMPACTION_FAILED" },
  });
  expect(transcript().at(-1)).toMatchObject({
    kind: "activity",
    tone: "error",
    label: "Context overflow recovery failed: boom",
    failure: "compaction-failed",
  });
});

test("pi's automatic summary shows as a live line, then a divider", () => {
  const { apply, transcript } = harness();
  apply({ type: "compactionStarted", sessionRef, timestamp, reason: "overflow" });
  expect(transcript().at(-1)).toMatchObject({ kind: "summary", compaction: "running" });

  // The live line stands in for the working line while the turn runs.
  const display = buildDisplayTimelineItems(
    transcript().filter((item) => item.kind !== "pin"),
    { lastTurnRunning: true },
  );
  expect(display.some((item) => item.kind === "working")).toBe(false);

  apply({
    type: "compactionEnded",
    sessionRef,
    timestamp,
    reason: "overflow",
    outcome: "succeeded",
    willRetry: true,
  });
  const summaries = transcript().filter((item) => item.kind === "summary");
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({ presentation: "divider", compaction: "done" });
  expect(
    buildDisplayTimelineItems(
      transcript().filter((item) => item.kind !== "pin"),
      { lastTurnRunning: true },
    ).at(-1)?.kind,
  ).toBe("working");
});

test("a failed or manual summary leaves no divider of its own", () => {
  const { apply, transcript } = harness();
  apply({ type: "compactionStarted", sessionRef, timestamp, reason: "threshold" });
  apply({
    type: "compactionEnded",
    sessionRef,
    timestamp,
    reason: "threshold",
    outcome: "failed",
    errorMessage: "Auto-compaction failed: boom",
    willRetry: false,
  });
  expect(transcript().some((item) => item.kind === "summary")).toBe(false);

  apply({ type: "compactionStarted", sessionRef, timestamp, reason: "manual" });
  apply({
    type: "compactionEnded",
    sessionRef,
    timestamp,
    reason: "manual",
    outcome: "succeeded",
    willRetry: false,
  });
  expect(transcript().some((item) => item.kind === "summary")).toBe(false);
});
