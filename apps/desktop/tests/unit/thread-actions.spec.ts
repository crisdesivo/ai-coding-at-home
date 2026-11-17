import { expect, test } from "@playwright/test";
import type { SessionRecord } from "../../contracts/desktop-state";
import {
  buildThreadActions,
  type ThreadActionHandlers,
} from "../../src/features/threads/thread-actions";

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    title: "Thread",
    updatedAt: "2026-09-23T00:00:00.000Z",
    preview: "",
    status: "idle",
    hasUnseenUpdate: false,
    ...overrides,
  };
}

function handlers(
  platform: NodeJS.Platform,
  scheduled = false,
): ThreadActionHandlers & { readonly calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
  };
  return {
    calls,
    platform,
    hasScheduledTask: () => scheduled,
    startRename: record("rename"),
    setPinned: (_subject, pinned) => calls.push(`pin:${pinned}`),
    archive: record("archive"),
    restore: record("restore"),
    markRead: record("mark-read"),
    openScheduledTask: record("scheduled"),
    copySessionId: record("copy"),
  };
}

function titles(actions: readonly { readonly title: string }[]): string[] {
  return actions.map((action) => action.title);
}

test("an open thread lists rename, pin, archive, scheduled task and copy with shortcut hints", () => {
  const actions = buildThreadActions({ workspaceId: "ws", session: session() }, handlers("darwin"));
  expect(titles(actions)).toEqual([
    "Rename thread",
    "Pin thread",
    "Archive thread",
    "Add scheduled task…",
    "Copy session ID",
  ]);
  expect(actions.find((action) => action.id === "rename-thread")?.hint).toBe("⇧⌘R");
  expect(actions.find((action) => action.id === "archive-thread")?.hint).toBe("⇧⌘A");
  const linux = buildThreadActions({ workspaceId: "ws", session: session() }, handlers("linux"));
  expect(linux.find((action) => action.id === "archive-thread")?.hint).toBe("Ctrl+Shift+A");
});

test("state changes the list: pinned, unseen, scheduled and archived threads", () => {
  const recorder = handlers("linux", true);
  const actions = buildThreadActions(
    { workspaceId: "ws", session: session({ pinnedAt: "x", hasUnseenUpdate: true }) },
    recorder,
  );
  expect(titles(actions)).toEqual([
    "Rename thread",
    "Unpin thread",
    "Archive thread",
    "Mark as read",
    "Edit scheduled task…",
    "Copy session ID",
  ]);
  actions.find((action) => action.id === "pin-thread")?.run();
  expect(recorder.calls).toEqual(["pin:false"]);

  const archived = buildThreadActions(
    { workspaceId: "ws", session: session({ archivedAt: "x" }) },
    handlers("linux"),
  );
  expect(titles(archived)).toEqual([
    "Rename thread",
    "Restore thread",
    "Add scheduled task…",
    "Copy session ID",
  ]);
  expect(archived.some((action) => action.id === "archive-thread")).toBe(false);
});

test("the open thread offers Clear conversation first, disabled while a reply runs", () => {
  const recorder = handlers("darwin");
  let cleared = 0;
  const idle = buildThreadActions({ workspaceId: "ws", session: session() }, recorder, {
    clearConversation: { busy: false, run: () => (cleared += 1) },
  });
  expect(titles(idle)[0]).toBe("Clear conversation");
  const clear = idle.find((action) => action.id === "clear-conversation");
  expect(clear?.hint).toBe("⇧⌘K");
  expect(clear?.disabledReason).toBeUndefined();
  clear?.run();
  expect(cleared).toBe(1);

  const running = buildThreadActions(
    { workspaceId: "ws", session: session({ status: "running" }) },
    handlers("linux"),
    { clearConversation: { busy: true, run: () => (cleared += 1) } },
  );
  const busy = running.find((action) => action.id === "clear-conversation");
  expect(busy?.hint).toBe("Ctrl+Shift+K");
  expect(busy?.disabledReason).toBe("Wait for the reply to finish");

  // Sidebar rows (no option) and archived threads never offer it.
  expect(
    buildThreadActions({ workspaceId: "ws", session: session() }, handlers("linux")).some(
      (action) => action.id === "clear-conversation",
    ),
  ).toBe(false);
  expect(
    buildThreadActions(
      { workspaceId: "ws", session: session({ archivedAt: "x" }) },
      handlers("linux"),
      { clearConversation: { busy: false, run: () => undefined } },
    ).some((action) => action.id === "clear-conversation"),
  ).toBe(false);
});
