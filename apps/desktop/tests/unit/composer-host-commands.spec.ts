import { expect, test } from "@playwright/test";
import type { SessionRef } from "@pi-gui/session-driver";
import { createConversationOwner } from "../../electron/conversation/app-store-composer";

const sessionRef: SessionRef = { workspaceId: "ws", sessionId: "sess" };
const key = "ws:sess";

/** Just enough of the store for the host slash commands (/compact, /name, /reload, /status). */
function commandHost(options: { readonly compactError?: string } = {}) {
  const calls: string[] = [];
  const sent: string[] = [];
  const errors: string[] = [];
  const composerDraftsBySession = new Map<string, string>();
  const host = {
    conversationState: {
      transcriptCache: new Map<string, readonly unknown[]>(),
      composerDraftsBySession,
      sessionCommandsBySession: new Map<string, readonly unknown[]>(),
      sessionConfigBySession: new Map<string, unknown>(),
      activeAssistantMessageBySession: new Map<string, string>(),
      sessionErrorsBySession: new Map<string, string>(),
    },
    driver: {
      compactSession: async (_ref: SessionRef, instructions?: string) => {
        calls.push(`compact:${instructions ?? ""}`);
        if (options.compactError) throw new Error(options.compactError);
      },
      renameSession: async (_ref: SessionRef, title: string) => {
        calls.push(`rename:${title}`);
      },
      reloadSession: async () => {
        calls.push("reload");
      },
      sendUserMessage: async (_ref: SessionRef, message: { text: string }) => {
        sent.push(message.text);
      },
    },
    runtimeForWorkspace: () => undefined,
    sessionFromState: () => ({ updatedAt: "2026-11-16T00:00:00.000Z", title: "T", status: "idle" }),
    reloadTranscriptFromDriver: async () => undefined,
    clearPendingAutoTitle: () => undefined,
    clearExtensionUiForSession: () => undefined,
    refreshSessionCommandsFor: async () => undefined,
    setComposerDraftForSession: (_ref: SessionRef, draft: string) => {
      composerDraftsBySession.set(key, draft);
    },
    applyLocalSessionUpdate: () => undefined,
    schedulePersistUiState: () => undefined,
    publishSelectedTranscriptFor: () => undefined,
    emit: () => ({ composerDraft: composerDraftsBySession.get(key) ?? "" }) as never,
    withSessionError: async (_ref: SessionRef, error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      return { composerDraft: composerDraftsBySession.get(key) ?? "" } as never;
    },
  };
  return { host, calls, sent, errors, composerDraftsBySession };
}

test("typed host slash commands reach the driver instead of the model", async () => {
  const { host, calls, sent, errors, composerDraftsBySession } = commandHost();
  const owner = createConversationOwner(host as never);

  composerDraftsBySession.set(key, "/compact keep the plan");
  await owner.submitComposerToSession(sessionRef, "/compact keep the plan", []);
  await owner.submitComposerToSession(sessionRef, "/compact", []);
  await owner.submitComposerToSession(sessionRef, "/name Pinned plan", []);
  await owner.submitComposerToSession(sessionRef, "/reload", []);
  await owner.submitComposerToSession(sessionRef, "/status", []);

  expect(calls).toEqual(["compact:keep the plan", "compact:", "rename:Pinned plan", "reload"]);
  expect(sent).toEqual([]);
  expect(errors).toEqual([]);
  expect(composerDraftsBySession.get(key)).toBe("");
});

test("a /compact pi refuses reports why and hands the command back", async () => {
  const { host, calls, sent, errors, composerDraftsBySession } = commandHost({
    compactError: "Nothing to compact (session too small)",
  });
  const owner = createConversationOwner(host as never);

  const state = await owner.submitComposerToSession(sessionRef, "/compact keep the plan", []);

  expect(calls).toEqual(["compact:keep the plan"]);
  expect(sent).toEqual([]);
  expect(errors).toEqual(["Nothing to compact (session too small)"]);
  expect(composerDraftsBySession.get(key)).toBe("/compact keep the plan");
  expect(state.composerDraft).toBe("/compact keep the plan");
});
