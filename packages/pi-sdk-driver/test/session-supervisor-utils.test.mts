import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshot,
  determineRunOutcome,
  lastRunOutcome,
  sessionRunOutcome,
  messageText,
  persistedToolOutput,
  shouldPersistSnapshotForAgentEvent,
  transcriptFromMessages,
} from "../dist/session-supervisor-utils.js";

const markdownParts = [
  "## Verification report",
  ["### Tests", "", "- Driver regression: passed", "- Electron projection: passed"].join("\n"),
  ["```text", "user prompt -> worker response", "```"].join("\n"),
];
const markdownReport = markdownParts.join("\n\n");

await test("messageText preserves Markdown newlines in array-shaped assistant content", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "text", text: markdownParts[0] },
      { type: "thinking", thinking: "Internal reasoning must not create a Markdown block." },
      { type: "text", text: markdownParts[1] },
      { type: "text", text: "" },
      { type: "text", text: markdownParts[2] },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  assert.equal(messageText(message), markdownReport);
});

await test("only a requested SDK abort is cancellation; actual provider errors remain failures", () => {
  const aborted = [
    { role: "assistant", stopReason: "aborted", errorMessage: "Request was aborted" },
  ];
  assert.deepEqual(determineRunOutcome(aborted, true), { status: "cancelled" });
  assert.deepEqual(determineRunOutcome(aborted), {
    status: "failed",
    error: { code: "ABORTED", message: "Request was aborted" },
  });
  assert.deepEqual(
    determineRunOutcome(
      [{ role: "assistant", stopReason: "error", errorMessage: "Request was aborted" }],
      true,
    ),
    {
      status: "failed",
      error: { code: "ERROR", message: "Request was aborted" },
    },
  );
  assert.deepEqual(
    determineRunOutcome(
      [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done" }] }],
      true,
    ),
    { status: "completed" },
  );
});

await test("a turn that shows nothing after the person's message is a failed run", () => {
  const noReply = {
    status: "failed",
    error: { code: "NO_REPLY", message: "The model ended its turn without writing a reply." },
  };
  const user = { role: "user", content: [{ type: "text", text: "Hello?" }] };
  // An empty "stop", or no reply at all, must not settle as a silent success.
  assert.deepEqual(
    determineRunOutcome([user, { role: "assistant", stopReason: "stop", content: [] }]),
    noReply,
  );
  assert.deepEqual(determineRunOutcome([user]), noReply);
  // Thinking alone is not something the person can read.
  assert.deepEqual(
    determineRunOutcome([
      user,
      { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "…" }] },
    ]),
    noReply,
  );
  // Tool calls since the message are visible work, even if the last reply has no text.
  assert.deepEqual(
    determineRunOutcome([
      user,
      {
        role: "assistant",
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "c", name: "ls", arguments: {} }],
      },
      { role: "toolResult", toolCallId: "c", content: [] },
      { role: "assistant", stopReason: "stop", content: [] },
    ]),
    { status: "completed" },
  );
  // A run that added nothing to answer (pi's retry after compacting adds only its reply).
  assert.deepEqual(determineRunOutcome([]), { status: "completed" });
});

await test("a reply cut off by the output limit before any text is a failed run", () => {
  // A full local context leaves the model room for a token or two: pi gets "length" and no text.
  assert.deepEqual(
    determineRunOutcome([
      { role: "assistant", stopReason: "length", content: [{ type: "text", text: "  " }] },
    ]),
    {
      status: "failed",
      error: {
        code: "OUT_OF_ROOM",
        message: "The model reached its output limit before writing a reply.",
      },
    },
  );
  assert.equal(
    determineRunOutcome([{ role: "assistant", stopReason: "length", content: [] }]).status,
    "failed",
  );
  // A long answer that was cut short is still an answer, and a tool call is still progress.
  assert.deepEqual(
    determineRunOutcome([
      { role: "assistant", stopReason: "length", content: [{ type: "text", text: "Part of it" }] },
    ]),
    { status: "completed" },
  );
  assert.deepEqual(
    determineRunOutcome([
      {
        role: "assistant",
        stopReason: "length",
        content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }],
      },
    ]),
    { status: "completed" },
  );
});

await test("the persist policy exempts streaming partials and keeps every discrete event", () => {
  // Persisting per message_update cost an atomic catalog write (fsync + rename +
  // directory fsync) per streamed token, serialized on the catalog's single
  // mutation queue, which is what made createSession hang during a stream.
  // This covers the policy across event types; session-supervisor-persist.test.mts
  // covers handleAgentEvent actually applying it.
  assert.equal(shouldPersistSnapshotForAgentEvent("message_update"), false);

  // Crash-recovery state must stay current to the last message boundary.
  for (const eventType of [
    "message_start",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "agent_end",
    "turn_start",
  ]) {
    assert.equal(shouldPersistSnapshotForAgentEvent(eventType), true, eventType);
  }
});

await test("persistedToolOutput keeps only the content and details Pi saves", () => {
  const content = [{ type: "text", text: "ok" }];
  const details = { exitCode: 0 };
  assert.deepEqual(
    persistedToolOutput({
      content,
      details,
      // Pi 0.99 bash results also carry up to 1 MiB of output here; Pi never saves it.
      structuredContent: { output: "ok", exit_code: 0 },
      isError: false,
    }),
    { content, details },
  );
  assert.deepEqual(persistedToolOutput({ content }), { content });
  assert.deepEqual(persistedToolOutput(undefined), {});
});

await test("transcriptFromMessages shows displayed custom messages the way terminal pi does", () => {
  const custom = (id: string, display: boolean, content: unknown) => ({
    role: "custom",
    id,
    customType: "ci-status",
    content,
    display,
    timestamp: Date.parse("2026-09-30T00:00:00.000Z"),
  });
  const transcript = transcriptFromMessages([
    custom("shown", true, [
      { type: "text", text: "**Build** passed" },
      { type: "image", data: "", mimeType: "image/png" },
      { type: "text", text: "- 12 tests" },
    ]),
    custom("hidden", false, "only for the model"),
    custom("empty", true, [{ type: "image", data: "", mimeType: "image/png" }]),
    custom("plain", true, "  as a string  "),
  ]);

  assert.deepEqual(transcript, [
    {
      kind: "custom",
      id: "shown",
      createdAt: "2026-09-30T00:00:00.000Z",
      customType: "ci-status",
      text: "**Build** passed\n\n- 12 tests",
    },
    {
      kind: "custom",
      id: "plain",
      createdAt: "2026-09-30T00:00:00.000Z",
      customType: "ci-status",
      text: "as a string",
    },
  ]);
});

await test("lastRunOutcome reports how the newest assistant reply ended", () => {
  const reply = (stopReason: string) => [
    { role: "user", content: "go" },
    { role: "assistant", stopReason, content: "partial" },
  ];
  assert.equal(lastRunOutcome([]), undefined);
  assert.equal(lastRunOutcome([{ role: "user", content: "go" }]), undefined);
  assert.equal(lastRunOutcome(reply("stop")), "completed");
  assert.equal(lastRunOutcome(reply("aborted")), "stopped");
  assert.equal(lastRunOutcome(reply("error")), "failed");
  assert.equal(lastRunOutcome(reply("length")), "incomplete");
  assert.equal(lastRunOutcome(reply("toolUse")), "incomplete");
  assert.equal(lastRunOutcome([...reply("aborted"), { role: "toolResult" }]), "stopped");
  assert.equal(lastRunOutcome([...reply("stop"), { role: "user", content: "and?" }]), "incomplete");
});

await test("a session stopped after partial text snapshots as stopped, not completed", () => {
  const source = {
    ref: { workspaceId: "workspace", sessionId: "session" },
    workspace: { workspaceId: "workspace", path: "/synthetic/workspace" },
    title: "Stopped turn",
    status: "idle" as const,
    updatedAt: new Date().toISOString(),
    archivedAt: undefined,
    preview: undefined,
    config: undefined,
    runningRunId: undefined,
    queuedMessages: [],
  };
  const stopped = [
    { role: "user", content: "write the report" },
    { role: "assistant", stopReason: "aborted", content: "Here is the first half of" },
  ];
  assert.equal(
    buildSnapshot({ ...source, session: { messages: stopped } }).lastRunOutcome,
    "stopped",
  );
  assert.equal(buildSnapshot(source).lastRunOutcome, undefined);
});

await test("a stopped reply reads as stopped only while it is still the newest reply", () => {
  const reply = { role: "assistant", stopReason: "stop", content: "Review in progress" };
  const branch: unknown[] = [
    { type: "message", id: "u1", message: { role: "user" } },
    { type: "message", id: "a1", message: reply },
    { type: "custom_message", id: "c1" },
  ];
  const session = {
    messages: [{ role: "user", content: "review" }, reply],
    sessionManager: { getBranch: () => branch },
  };
  assert.equal(sessionRunOutcome({ session }), "completed");
  assert.equal(sessionRunOutcome({ session, stoppedReplyId: "a1" }), "stopped");
  // A newer reply, from this app or pi run elsewhere, or another branch, decides on its own.
  branch.push({ type: "message", id: "a2", message: reply });
  assert.equal(sessionRunOutcome({ session, stoppedReplyId: "a1" }), "completed");
});
