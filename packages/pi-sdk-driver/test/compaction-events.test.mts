import assert from "node:assert/strict";
import test from "node:test";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { SessionSupervisor } from "../dist/index.js";

type Mapper = {
  mapAgentEvent(record: ReturnType<typeof makeRecord>, event: unknown): SessionDriverEvent[];
};

function makeRecord() {
  return {
    ref: { workspaceId: "workspace", sessionId: "session" },
    workspace: { workspaceId: "workspace", path: "/synthetic/workspace" },
    title: "Small local model",
    status: "running",
    updatedAt: new Date().toISOString(),
    runningRunId: "run",
    cancellationRequested: false,
    compactionFailure: undefined as string | undefined,
    queuedMessages: [],
  };
}

// Runtime-event translation only: no live session, provider, disk state or agent dir.
const supervisor = new SessionSupervisor() as unknown as Mapper;

const lengthStop = {
  role: "assistant",
  stopReason: "length",
  content: [],
  usage: { input: 12_500, output: 1 },
};

function compactionEnded(events: readonly SessionDriverEvent[]) {
  return events.find((event) => event.type === "compactionEnded");
}

await test("pi's compaction_end becomes compactionEnded with an outcome", () => {
  const record = makeRecord();
  const succeeded = compactionEnded(
    supervisor.mapAgentEvent(record, {
      type: "compaction_end",
      reason: "overflow",
      result: { summary: "Earlier work", firstKeptEntryId: "e1", tokensBefore: 15_000 },
      aborted: false,
      willRetry: true,
    }),
  );
  assert.deepEqual(
    succeeded && {
      type: succeeded.type,
      reason: "reason" in succeeded ? succeeded.reason : undefined,
      outcome: "outcome" in succeeded ? succeeded.outcome : undefined,
      willRetry: "willRetry" in succeeded ? succeeded.willRetry : undefined,
      runId: succeeded.runId,
    },
    {
      type: "compactionEnded",
      reason: "overflow",
      outcome: "succeeded",
      willRetry: true,
      runId: "run",
    },
  );
  assert.equal(record.compactionFailure, undefined);

  const cancelled = compactionEnded(
    supervisor.mapAgentEvent(record, {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: true,
      willRetry: false,
    }),
  );
  assert.equal(cancelled && "outcome" in cancelled ? cancelled.outcome : undefined, "cancelled");
  assert.equal(record.compactionFailure, undefined, "a cancelled compaction is not a failure");
});

await test("a length stop with no text settles as an out-of-room failure", () => {
  const record = makeRecord();
  supervisor.mapAgentEvent(record, { type: "agent_end", messages: [lengthStop] });
  const events = supervisor.mapAgentEvent(record, { type: "agent_settled", aborted: false });
  const failed = events.find((event) => event.type === "runFailed");
  assert.ok(failed && failed.type === "runFailed", "the run must not settle silently");
  assert.equal(failed.error.code, "OUT_OF_ROOM");
  assert.equal(failed.runId, "run");
  assert.equal(record.status, "failed");
});

await test("a failed automatic compaction ends the run as a compaction failure", () => {
  const record = makeRecord();
  supervisor.mapAgentEvent(record, { type: "agent_end", messages: [lengthStop] });
  const ended = compactionEnded(
    supervisor.mapAgentEvent(record, {
      type: "compaction_end",
      reason: "overflow",
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: "Context overflow recovery failed: Nothing to summarize",
    }),
  );
  assert.ok(ended && ended.type === "compactionEnded");
  assert.equal(ended.outcome, "failed");
  assert.equal(ended.errorMessage, "Context overflow recovery failed: Nothing to summarize");

  const events = supervisor.mapAgentEvent(record, { type: "agent_settled", aborted: false });
  const failed = events.find((event) => event.type === "runFailed");
  assert.ok(failed && failed.type === "runFailed");
  assert.deepEqual(failed.error, {
    code: "COMPACTION_FAILED",
    message: "Context overflow recovery failed: Nothing to summarize",
  });
  assert.equal(record.compactionFailure, undefined, "the failure is reported once");

  // The next run that answers completes normally.
  supervisor.mapAgentEvent(record, { type: "agent_start" });
  supervisor.mapAgentEvent(record, {
    type: "agent_end",
    messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Hi" }] }],
  });
  const next = supervisor.mapAgentEvent(record, { type: "agent_settled", aborted: false });
  assert.ok(next.some((event) => event.type === "runCompleted"));
});

await test("pi's own recovery retry that answers completes the run", () => {
  const record = makeRecord();
  supervisor.mapAgentEvent(record, { type: "agent_end", messages: [lengthStop] });
  supervisor.mapAgentEvent(record, {
    type: "compaction_end",
    reason: "overflow",
    result: { summary: "Earlier work", firstKeptEntryId: "e1", tokensBefore: 15_000 },
    aborted: false,
    willRetry: true,
  });
  // pi continues the turn after compacting; the retry's reply decides the outcome.
  supervisor.mapAgentEvent(record, { type: "agent_start" });
  supervisor.mapAgentEvent(record, {
    type: "agent_end",
    messages: [
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done" }] },
    ],
  });
  const events = supervisor.mapAgentEvent(record, { type: "agent_settled", aborted: false });
  assert.ok(events.some((event) => event.type === "runCompleted"));
  assert.ok(!events.some((event) => event.type === "runFailed"));
});

await test("a failed manual /compact is left to its caller", () => {
  const record = makeRecord();
  supervisor.mapAgentEvent(record, {
    type: "compaction_end",
    reason: "manual",
    result: undefined,
    aborted: false,
    willRetry: false,
    errorMessage: "Compaction failed: Nothing to compact (session too small)",
  });
  assert.equal(record.compactionFailure, undefined);
});

await test("a Stop wins over a compaction failure", () => {
  const record = { ...makeRecord(), cancellationRequested: true };
  supervisor.mapAgentEvent(record, {
    type: "compaction_end",
    reason: "threshold",
    result: undefined,
    aborted: false,
    willRetry: false,
    errorMessage: "Auto-compaction failed: boom",
  });
  const events = supervisor.mapAgentEvent(record, { type: "agent_settled", aborted: true });
  assert.ok(!events.some((event) => event.type === "runFailed"));
});

await test("the thread is busy while pi summarizes, and idle again after a summary between runs", () => {
  const record = {
    ...makeRecord(),
    status: "idle",
    runningRunId: undefined as string | undefined,
    runAwaitingSettle: false,
    promptStarting: false,
  };
  const started = supervisor.mapAgentEvent(record, { type: "compaction_start", reason: "manual" });
  assert.equal(started[0]?.type, "compactionStarted");
  assert.equal(record.status, "running");
  const updated = started.find((event) => event.type === "sessionUpdated");
  assert.equal(updated && "snapshot" in updated ? updated.snapshot.status : undefined, "running");
  supervisor.mapAgentEvent(record, {
    type: "compaction_end",
    reason: "manual",
    result: { summary: "s", firstKeptEntryId: "e", tokensBefore: 1 },
    aborted: false,
    willRetry: false,
  });
  assert.equal(record.status, "idle");
});

await test("a summary during a run leaves the run running", () => {
  const record = { ...makeRecord(), runAwaitingSettle: true };
  supervisor.mapAgentEvent(record, { type: "compaction_start", reason: "overflow" });
  supervisor.mapAgentEvent(record, {
    type: "compaction_end",
    reason: "overflow",
    result: { summary: "s", firstKeptEntryId: "e", tokensBefore: 1 },
    aborted: false,
    willRetry: true,
  });
  assert.equal(record.status, "running");
});

await test("pi giving up on its own overflow recovery is a compaction failure", () => {
  const record = makeRecord();
  supervisor.mapAgentEvent(record, { type: "agent_end", messages: [lengthStop] });
  // pi emits this without a compaction_start when its one compact-and-retry already ran.
  supervisor.mapAgentEvent(record, {
    type: "compaction_end",
    reason: "overflow",
    result: undefined,
    aborted: false,
    willRetry: false,
    errorMessage: "Truncated response recovery failed after one compact-and-retry attempt.",
  });
  const events = supervisor.mapAgentEvent(record, { type: "agent_settled", aborted: false });
  const failed = events.find((event) => event.type === "runFailed");
  assert.ok(failed && failed.type === "runFailed");
  assert.equal(failed.error.code, "COMPACTION_FAILED");
});
