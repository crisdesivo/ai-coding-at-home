import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DesktopAppState, WorkspaceSessionTarget } from "../../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import { updateSnapshot } from "../../../app/desktop-app-state";

/** How long the "Conversation cleared" notice offers Undo. */
export const CLEAR_CONVERSATION_UNDO_MS = 10_000;

interface UseClearConversationParams {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  /** Sends the open thread's debounced draft now, before archiving deselects that thread. */
  readonly flushComposerDraft: () => void;
  /** The New thread flow, opened on the given folder. */
  readonly openNewThread: (workspaceId: string) => void;
  /** Opens a thread the way a sidebar click does. */
  readonly selectThread: (target: WorkspaceSessionTarget) => void;
}

export interface ClearedConversation {
  readonly target: WorkspaceSessionTarget;
  /** Changes with each clear, so a second clear restarts the notice. */
  readonly id: number;
}

export interface ClearConversationState {
  /** The last cleared thread while its Undo is still offered. */
  readonly cleared: ClearedConversation | null;
  /**
   * Like /clear in a terminal: archives the thread and opens New thread on the same
   * folder. `discardDraft` drops the composer text (the `/clear` the user typed)
   * instead of keeping it with the archived thread.
   */
  readonly clear: (
    target: WorkspaceSessionTarget,
    options?: { readonly discardDraft?: boolean },
  ) => void;
  /** Restores the archived thread and opens it again. */
  readonly undo: () => void;
  readonly dismiss: () => void;
}

function isArchived(state: DesktopAppState, target: WorkspaceSessionTarget): boolean {
  return Boolean(
    state.workspaces
      .find((workspace) => workspace.id === target.workspaceId)
      ?.sessions.find((session) => session.id === target.sessionId)?.archivedAt,
  );
}

/**
 * Clear conversation reuses the thread archive and the New thread flow: nothing is
 * deleted, the old thread stays under Archived, and no empty thread is made until
 * the user sends something, so Undo has nothing to throw away.
 */
export function useClearConversation({
  api,
  setSnapshot,
  flushComposerDraft,
  openNewThread,
  selectThread,
}: UseClearConversationParams): ClearConversationState {
  const [cleared, setCleared] = useState<ClearedConversation | null>(null);
  const clearingRef = useRef(false);
  const nextIdRef = useRef(0);

  useEffect(() => {
    if (!cleared) return undefined;
    const timeout = window.setTimeout(() => {
      setCleared((current) => (current === cleared ? null : current));
    }, CLEAR_CONVERSATION_UNDO_MS);
    return () => window.clearTimeout(timeout);
  }, [cleared]);

  const clear: ClearConversationState["clear"] = (target, options = {}) => {
    if (!api || clearingRef.current) return;
    clearingRef.current = true;
    void (async () => {
      if (options.discardDraft) {
        await api.updateComposerDraft("", target);
      } else {
        flushComposerDraft();
      }
      const state = await updateSnapshot(setSnapshot, () => api.archiveSession(target));
      if (!isArchived(state, target)) return;
      openNewThread(target.workspaceId);
      nextIdRef.current += 1;
      setCleared({ target, id: nextIdRef.current });
    })()
      .catch((error: unknown) => {
        console.error("[renderer] clear conversation failed", error);
      })
      .finally(() => {
        clearingRef.current = false;
      });
  };

  const undo = () => {
    if (!api || !cleared) return;
    const { target } = cleared;
    setCleared(null);
    void updateSnapshot(setSnapshot, () => api.unarchiveSession(target))
      .then(() => selectThread(target))
      .catch((error: unknown) => {
        console.error("[renderer] undo clear conversation failed", error);
      });
  };

  return { cleared, clear, undo, dismiss: () => setCleared(null) };
}
