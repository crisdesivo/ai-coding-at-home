import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { RunProgress, SessionDriverEvent } from "@pi-gui/session-driver";
import { SessionSupervisor } from "../dist/index.js";
import {
  RUN_PROGRESS_INTERVAL_MS,
  RunProgressTracker,
  heredocTargetFile,
  streamingToolCallFile,
} from "../dist/run-progress.js";

type Mapper = {
  mapAgentEvent(record: ReturnType<typeof makeRecord>, event: unknown): SessionDriverEvent[];
};

function makeRecord(received: SessionDriverEvent[] = []) {
  return {
    ref: { workspaceId: "workspace", sessionId: "session" },
    workspace: { workspaceId: "workspace", path: "/synthetic/workspace" },
    title: "Slow local model",
    status: "running",
    updatedAt: new Date().toISOString(),
    runningRunId: "run" as string | undefined,
    cancellationRequested: false,
    compactionFailure: undefined as string | undefined,
    queuedMessages: [],
    startedQueuedMessageIds: new Set<string>(),
    closed: false,
    listeners: new Set([(event: SessionDriverEvent) => void received.push(event)]),
    eventQueue: Promise.resolve(),
  };
}

/** A partial assistant message whose only block is a tool call with these arguments so far. */
function toolCallPartial(name: string, args: Record<string, unknown>) {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name, arguments: args }],
    usage: { input: 0, output: 0 },
  };
}

function toolCallDelta(name: string, args: Record<string, unknown>) {
  const partial = toolCallPartial(name, args);
  return {
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "x", partial },
  };
}

function progressOf(events: readonly SessionDriverEvent[]): RunProgress | undefined {
  const event = events.find((candidate) => candidate.type === "runProgress");
  return event && "progress" in event ? event.progress : undefined;
}

await test("a bash heredoc names the file it writes; other commands name none", () => {
  assert.equal(heredocTargetFile("cat > src/board.js <<'EOF'\nconst a = 1;\n"), "board.js");
  assert.equal(heredocTargetFile('cat <<"EOF" > "my notes.md"\n# hi'), "my notes.md");
  assert.equal(heredocTargetFile("cd game && cat >> index.html << EOF"), "index.html");
  assert.equal(heredocTargetFile("tee -a /tmp/log.txt <<EOF\nline"), "log.txt");
  assert.equal(heredocTargetFile("cat <<-END >game/style.css\n"), "style.css");
  assert.equal(heredocTargetFile("python3 - <<'EOF'\nprint(1)\n"), undefined);
  assert.equal(heredocTargetFile("cat > out.txt"), undefined, "no heredoc");
  assert.equal(heredocTargetFile("ls -la 2>&1 > /dev/null <<EOF"), undefined);
  assert.equal(heredocTargetFile("cat > "), undefined, "target not streamed yet");
  assert.equal(streamingToolCallFile("write", { path: "/home/me/checkers/app.js" }), "app.js");
  assert.equal(streamingToolCallFile("edit", { path: "README.md", edits: [] }), "README.md");
  assert.equal(streamingToolCallFile("write", {}), undefined);
  assert.equal(streamingToolCallFile("grep", { pattern: "x", path: "a.txt" }), undefined);
});

await test("the tracker counts this step's tokens, its speed and what the model writes", () => {
  const tracker = new RunProgressTracker(1_000);
  assert.deepEqual(tracker.snapshot(), {
    activity: { kind: "waiting" },
    stepStartedAt: new Date(1_000).toISOString(),
    stepTokens: 0,
  });

  const thinking = { role: "assistant", content: [], usage: { output: 0 } };
  tracker.recordAssistantEvent(
    { type: "thinking_delta", contentIndex: 0, delta: "Hm", partial: thinking } as never,
    2_000,
  );
  assert.deepEqual(tracker.snapshot().activity, { kind: "thinking" });

  // A slow model: one token every 250 ms is 4 tokens per second.
  let partial = toolCallPartial("bash", {});
  tracker.recordAssistantEvent(
    { type: "toolcall_start", contentIndex: 0, partial } as never,
    2_100,
  );
  assert.deepEqual(tracker.snapshot().activity, { kind: "writingToolCall", toolName: "bash" });
  partial = toolCallPartial("bash", { command: "cat > board.js <<'EOF'\nconst" });
  for (let index = 1; index <= 4; index += 1) {
    tracker.recordAssistantEvent(
      { type: "toolcall_delta", contentIndex: 0, delta: "t", partial } as never,
      2_000 + index * 250,
    );
  }
  const writing = tracker.snapshot();
  assert.deepEqual(writing.activity, {
    kind: "writingFile",
    toolName: "bash",
    fileName: "board.js",
  });
  assert.equal(writing.stepTokens, 5);
  assert.equal(writing.tokensPerSecond, 4);
  assert.equal(writing.lastOutputAt, new Date(3_000).toISOString());

  // The provider's own count wins when it is higher.
  tracker.recordAssistantEvent(
    {
      type: "done",
      reason: "toolUse",
      message: { ...partial, usage: { input: 10, output: 9 } },
    } as never,
    3_100,
  );
  assert.equal(tracker.snapshot().stepTokens, 9);

  // Running the tool is a new step without tokens; the run keeps its last output time.
  tracker.startTool("call-1", "bash", { command: "npm test -- --watch=false\necho done" }, 3_200);
  const running = tracker.snapshot();
  assert.deepEqual(running.activity, {
    kind: "runningTool",
    toolName: "bash",
    detail: "npm test -- --watch=false",
  });
  assert.equal(running.stepTokens, 0);
  assert.equal(running.tokensPerSecond, undefined);
  assert.equal(running.stepStartedAt, new Date(3_200).toISOString());
  assert.equal(running.lastOutputAt, new Date(3_000).toISOString());

  tracker.endTool("call-1", 5_000);
  assert.deepEqual(tracker.snapshot().activity, { kind: "waiting" });
  assert.equal(tracker.snapshot().stepStartedAt, new Date(5_000).toISOString());

  tracker.startReply(5_100);
  const reply = { role: "assistant", content: [{ type: "text", text: "" }], usage: {} };
  tracker.recordAssistantEvent(
    { type: "text_delta", contentIndex: 0, delta: "Done", partial: reply } as never,
    6_000,
  );
  assert.deepEqual(tracker.snapshot().activity, { kind: "replying" });
  assert.equal(tracker.snapshot().stepTokens, 1);
});

await test("pi's streaming events become runProgress events, at most four a second", async () => {
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10_000 });
  try {
    const received: SessionDriverEvent[] = [];
    const record = makeRecord(received);
    const supervisor = new SessionSupervisor() as unknown as Mapper;

    const started = progressOf(supervisor.mapAgentEvent(record, { type: "agent_start" }));
    assert.deepEqual(started?.activity, { kind: "waiting" });
    assert.equal(
      supervisor.mapAgentEvent(record, { type: "agent_start" }).at(-1)?.runId,
      "run",
      "progress carries the run id",
    );

    // Throttled: the deltas right after are held back, then sent once by a trailing timer.
    mock.timers.tick(RUN_PROGRESS_INTERVAL_MS);
    const first = progressOf(
      supervisor.mapAgentEvent(record, toolCallDelta("write", { path: "game/board.js" })),
    );
    assert.deepEqual(first?.activity, {
      kind: "writingFile",
      toolName: "write",
      fileName: "board.js",
    });
    assert.equal(first?.stepTokens, 1);
    for (let index = 0; index < 5; index += 1) {
      mock.timers.tick(20);
      const events = supervisor.mapAgentEvent(
        record,
        toolCallDelta("write", { path: "game/board.js", content: "x".repeat(index) }),
      );
      assert.equal(progressOf(events), undefined, "held back by the throttle");
    }
    mock.timers.tick(RUN_PROGRESS_INTERVAL_MS);
    await record.eventQueue;
    const trailing = received.filter((event) => event.type === "runProgress");
    assert.equal(trailing.length, 1, "one trailing event for the held-back deltas");
    assert.equal(progressOf(trailing)?.stepTokens, 6);

    // Calls a tool makes through ctx.executeTool() do not count.
    mock.timers.tick(RUN_PROGRESS_INTERVAL_MS);
    assert.deepEqual(
      supervisor.mapAgentEvent(record, {
        type: "tool_execution_start",
        toolCallId: "child",
        toolName: "read",
        args: {},
        parentToolCallId: "call-1",
      }),
      [],
    );

    // Settling clears the tracker; a timer still pending sends nothing.
    supervisor.mapAgentEvent(record, toolCallDelta("write", { path: "game/board.js" }));
    supervisor.mapAgentEvent(record, toolCallDelta("write", { path: "game/board.js" }));
    supervisor.mapAgentEvent(record, { type: "agent_settled", aborted: false });
    received.length = 0;
    mock.timers.tick(RUN_PROGRESS_INTERVAL_MS * 2);
    await record.eventQueue;
    assert.equal(received.filter((event) => event.type === "runProgress").length, 0);
    assert.equal(
      progressOf(supervisor.mapAgentEvent(record, toolCallDelta("write", { path: "a.js" }))),
      undefined,
      "no progress outside a run",
    );
  } finally {
    mock.timers.reset();
  }
});
