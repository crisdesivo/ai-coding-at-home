import { expect, test } from "@playwright/test";
import {
  expectAppView,
  expectCreateProjectInput,
  expectCreateScheduledTaskInput,
  expectForkThreadInput,
  expectHostUiResponse,
  expectNotificationPreferences,
  expectOptionalDeliverOptions,
  expectSessionTarget,
  expectSetChildSupervisionLoopInput,
  expectStartThreadInput,
  expectStringArray,
  expectTerminalSize,
  expectThemeMode,
  expectThemePresetId,
} from "../../electron/ipc/request-validation";

test("IPC request validation returns a fresh trusted session target", () => {
  const request = { workspaceId: " workspace-a ", sessionId: " session-a " };

  const target = expectSessionTarget(request);

  expect(target).toEqual({ workspaceId: "workspace-a", sessionId: "session-a" });
  expect(target).not.toBe(request);
});

test("IPC request validation rejects malformed targets and string lists", () => {
  expect(() => expectSessionTarget({ workspaceId: "workspace-a" })).toThrow(
    "target.sessionId must be a string",
  );
  expect(() => expectSessionTarget({ workspaceId: "", sessionId: "session-a" })).toThrow(
    "target.workspaceId must not be empty",
  );
  expect(() => expectStringArray(["safe", 4], "order")).toThrow(
    "order must be an array of strings",
  );
});

test("IPC request validation allowlists composer delivery modes", () => {
  expect(expectOptionalDeliverOptions(undefined)).toBeUndefined();
  expect(expectOptionalDeliverOptions({ deliverAs: "steer" })).toEqual({ deliverAs: "steer" });
  expect(expectOptionalDeliverOptions({ deliverAs: "followUp" })).toEqual({
    deliverAs: "followUp",
  });
  expect(() => expectOptionalDeliverOptions({ deliverAs: "immediate" })).toThrow(
    "options.deliverAs must be steer or followUp",
  );
});

test("IPC request validation rejects unknown enum values", () => {
  expect(expectAppView("new-thread")).toBe("new-thread");
  expect(expectAppView("scheduled")).toBe("scheduled");
  expect(expectThemeMode("dark")).toBe("dark");
  expect(expectThemePresetId("tokyo-night")).toBe("tokyo-night");

  expect(() => expectAppView("terminal")).toThrow("view must be a supported app view");
  expect(() => expectThemeMode("auto")).toThrow("mode must be system, light, or dark");
  expect(() => expectThemePresetId("solarized")).toThrow(
    "presetId must be a supported theme preset",
  );
});

test("IPC request validation decodes persisted settings records", () => {
  expect(
    expectNotificationPreferences({
      backgroundCompletion: true,
      backgroundFailure: false,
      attentionNeeded: true,
    }),
  ).toEqual({
    backgroundCompletion: true,
    backgroundFailure: false,
    attentionNeeded: true,
  });
  expect(() =>
    expectNotificationPreferences({
      backgroundCompletion: "yes",
      backgroundFailure: false,
      attentionNeeded: true,
    }),
  ).toThrow("preferences.backgroundCompletion must be a boolean");
});

test("IPC request validation checks discriminated command records", () => {
  expect(expectHostUiResponse({ requestId: "request-a", confirmed: false })).toEqual({
    requestId: "request-a",
    confirmed: false,
  });
  expect(() =>
    expectHostUiResponse({ requestId: "request-a", confirmed: true, cancelled: true }),
  ).toThrow("response must contain exactly one of value, confirmed, or cancelled");

  expect(
    expectForkThreadInput({
      sourceWorkspaceId: "workspace-a",
      sourceSessionId: "session-a",
      rootWorkspaceId: "workspace-a",
      environment: "local",
      position: "after",
      sourceMessageIndex: 3,
    }),
  ).toMatchObject({ environment: "local", position: "after", sourceMessageIndex: 3 });
  expect(() =>
    expectForkThreadInput({
      sourceWorkspaceId: "workspace-a",
      sourceSessionId: "session-a",
      rootWorkspaceId: "workspace-a",
      environment: "cloud",
    }),
  ).toThrow("input.environment must be local or worktree");

  expect(() =>
    expectSetChildSupervisionLoopInput({ childThreadId: "child-a", gate: "wake" }),
  ).toThrow("input.gate must be continue or stop");
  expect(() => expectTerminalSize({ cols: 0, rows: 24 })).toThrow(
    "size.cols must be a positive integer",
  );
});

test("notification checkbox patches validate only provided fields", () => {
  for (const key of ["backgroundCompletion", "backgroundFailure", "attentionNeeded"] as const) {
    expect(expectNotificationPreferences({ [key]: false })).toEqual({ [key]: false });
    expect(() => expectNotificationPreferences({ [key]: "false" })).toThrow(
      `preferences.${key} must be a boolean`,
    );
    expect(() => expectNotificationPreferences({ [key]: undefined })).toThrow(
      `preferences.${key} must be a boolean`,
    );
  }
  expect(expectNotificationPreferences({})).toEqual({});
});

test("IPC request validation rejects malformed scheduled tasks", () => {
  const target = { kind: "new-thread", workspaceId: "ws" };
  expect(() =>
    expectCreateScheduledTaskInput({
      title: "",
      instruction: "do it",
      schedule: { kind: "once", at: "2026-09-21T12:00:00.000Z" },
      target,
    }),
  ).toThrow("input.title must not be empty");
  expect(() =>
    expectCreateScheduledTaskInput({
      title: "Ping",
      instruction: "   ",
      schedule: { kind: "once", at: "2026-09-21T12:00:00.000Z" },
      target,
    }),
  ).toThrow("input.instruction must not be empty");
  expect(() =>
    expectCreateScheduledTaskInput({
      title: "Ping",
      instruction: "do it",
      schedule: { kind: "interval", everyMs: 1_000 },
      target,
    }),
  ).toThrow(/everyMs/);
  expect(() =>
    expectCreateScheduledTaskInput({
      title: "Ping",
      instruction: "do it",
      schedule: { kind: "weekly", days: [], hour: 9, minute: 0, timeZone: "UTC" },
      target,
    }),
  ).toThrow(/days/);
  expect(() =>
    expectCreateScheduledTaskInput({
      title: "Ping",
      instruction: "do it",
      schedule: { kind: "daily", hour: 9, minute: 0, timeZone: "Not/A_Zone" },
      target,
    }),
  ).toThrow(/timeZone/);
});

test("IPC request validation passes new-thread extension flags through as booleans and strings", () => {
  const base = { rootWorkspaceId: "workspace-a", environment: "local" };

  expect(expectStartThreadInput(base).extensionFlags).toBeUndefined();
  // pi at home has one local model: a start never carries a model or reasoning choice.
  expect(
    expectStartThreadInput({
      ...base,
      provider: "openai",
      modelId: "gpt-5",
      thinkingLevel: "high",
    }),
  ).not.toHaveProperty("provider");
  expect(
    expectStartThreadInput({
      ...base,
      extensionFlags: { plan: true, "dry-run": false, env: "staging", preset: "" },
    }).extensionFlags,
  ).toEqual({ plan: true, "dry-run": false, env: "staging", preset: "" });

  expect(() => expectStartThreadInput({ ...base, extensionFlags: ["plan"] })).toThrow(
    "input.extensionFlags must be an object",
  );
  expect(() => expectStartThreadInput({ ...base, extensionFlags: { retries: 3 } })).toThrow(
    "input.extensionFlags.retries must be a boolean or string",
  );
  expect(() => expectStartThreadInput({ ...base, extensionFlags: { plan: null } })).toThrow(
    "input.extensionFlags.plan must be a boolean or string",
  );
  expect(() => expectStartThreadInput({ ...base, extensionFlags: { " ": true } })).toThrow(
    "flag names must be non-empty",
  );
});

test("IPC request validation cleans Create project input and rejects unsafe requests", () => {
  expect(expectCreateProjectInput({ name: "  Q1/Q2 plan ", parentDir: " /tmp/projects " })).toEqual(
    { name: "q1-q2-plan", parentDir: "/tmp/projects" },
  );
  expect(
    expectCreateProjectInput({ name: "Notes", parentDir: "C:\\Users\\me", openExisting: true }),
  ).toEqual({ name: "notes", parentDir: "C:\\Users\\me", openExisting: true });

  expect(() => expectCreateProjectInput("Notes")).toThrow("input must be an object");
  expect(() => expectCreateProjectInput({ name: 4, parentDir: "/tmp" })).toThrow(
    "input.name must be a string",
  );
  expect(() => expectCreateProjectInput({ name: "Notes", parentDir: "" })).toThrow(
    "input.parentDir must not be empty",
  );
  expect(() => expectCreateProjectInput({ name: "Notes", parentDir: "projects" })).toThrow(
    "input.parentDir must be an absolute folder path",
  );
  expect(() => expectCreateProjectInput({ name: "Notes", parentDir: "/tmp/a\0b" })).toThrow(
    "input.parentDir must be an absolute folder path",
  );
  expect(() => expectCreateProjectInput({ name: "  ", parentDir: "/tmp" })).toThrow(
    "input.name is not a valid project name (empty)",
  );
  expect(() => expectCreateProjectInput({ name: "..", parentDir: "/tmp" })).toThrow("(noLetters)");
  expect(() => expectCreateProjectInput({ name: "nul", parentDir: "/tmp" })).toThrow("(reserved)");
  expect(() => expectCreateProjectInput({ name: "x".repeat(101), parentDir: "/tmp" })).toThrow(
    "(tooLong)",
  );
  expect(() =>
    expectCreateProjectInput({ name: "Notes", parentDir: "/tmp", openExisting: "yes" }),
  ).toThrow("input.openExisting must be a boolean");
  expect(() =>
    expectCreateProjectInput({ name: "Notes", parentDir: "/tmp", overwrite: true }),
  ).toThrow("input contains an unsupported field");
});
