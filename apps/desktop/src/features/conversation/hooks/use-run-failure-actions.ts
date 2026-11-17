import { useState, type Dispatch, type SetStateAction } from "react";
import type { DesktopAppState } from "../../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import { updateSnapshot } from "../../../app/desktop-app-state";
import type { RunFailureActions } from "../run-failure-card";

interface UseRunFailureActionsParams {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  /** The open thread's key, so a retry still under way in one thread never blocks another. */
  readonly sessionKey: string | undefined;
  /** The open thread is replying (or pi is summarizing it as part of a reply). */
  readonly running: boolean;
  /** Clear conversation for the open thread. */
  readonly startFresh: () => void;
}

/**
 * The failure card's buttons. A retry first summarizes (minutes on a small local model) before
 * the thread shows as running again, so the buttons also wait for the retry request itself.
 */
export function useRunFailureActions({
  api,
  setSnapshot,
  sessionKey,
  running,
  startFresh,
}: UseRunFailureActionsParams): RunFailureActions | undefined {
  const [retryingKeys, setRetryingKeys] = useState<ReadonlySet<string>>(() => new Set());
  if (!api || !sessionKey) return undefined;
  const busy = running || retryingKeys.has(sessionKey);
  const retry: RunFailureActions["retry"] = (options) => {
    if (busy) return;
    setRetryingKeys((current) => new Set(current).add(sessionKey));
    void updateSnapshot(setSnapshot, () => api.retryAfterFailure(options))
      .catch((error: unknown) => {
        console.error("[renderer] retryAfterFailure failed", error);
      })
      .finally(() => {
        setRetryingKeys((current) => {
          const next = new Set(current);
          next.delete(sessionKey);
          return next;
        });
      });
  };
  return {
    busy,
    retry,
    startFresh: () => {
      if (!busy) startFresh();
    },
  };
}
