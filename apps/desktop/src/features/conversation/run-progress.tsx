import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { RunProgress, RunProgressActivity } from "@pi-gui/session-driver/types";
import { QUIET_NOTICE_AFTER_MS } from "../../../contracts/run-progress";
import { useTranslation, type Translate } from "../../i18n";

/** The selected thread's running turn, for the working line at the end of the timeline. */
export interface RunProgressContextValue {
  readonly progress?: RunProgress;
  /** The composer's Stop action, offered again when the local AI goes quiet. */
  readonly onStop?: () => void;
  readonly quietNoticeAfterMs: number;
}

export const RunProgressContext = createContext<RunProgressContextValue>({
  quietNoticeAfterMs: QUIET_NOTICE_AFTER_MS,
});

/** The context value for the selected thread; stable while nothing in it changes. */
export function useRunProgressContext(
  progress: RunProgress | undefined,
  onStop: () => void,
  quietNoticeAfterMs: number | undefined,
): RunProgressContextValue {
  const threshold = quietNoticeAfterMs ?? QUIET_NOTICE_AFTER_MS;
  return useMemo(
    () => ({ ...(progress ? { progress } : {}), onStop, quietNoticeAfterMs: threshold }),
    [progress, onStop, threshold],
  );
}

/** Longest command text the line shows before it cuts it short. */
const COMMAND_PREVIEW_LENGTH = 48;

/** Re-renders once a second while `active`, so elapsed times and the quiet notice stay live. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);
  return now;
}

export function formatDuration(t: Translate, ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return t("duration.seconds", { seconds: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return t("duration.minutes", { minutes, seconds: totalSeconds % 60 });
  return t("duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function shortCommand(command: string): string {
  const line = command.trim();
  return line.length > COMMAND_PREVIEW_LENGTH ? line.slice(0, COMMAND_PREVIEW_LENGTH) : line;
}

/** Plain words for what the turn is doing. */
export function describeActivity(t: Translate, activity: RunProgressActivity): string {
  switch (activity.kind) {
    case "waiting":
      return t("runProgress.waiting");
    case "thinking":
      return t("runProgress.thinking");
    case "replying":
      return t("runProgress.replying");
    case "writingToolCall":
      return t("runProgress.writingCommand");
    case "writingFile":
      return t("runProgress.writingFile", { file: activity.fileName });
    case "runningTool":
      if (activity.toolName === "bash" && activity.detail) {
        return t("runProgress.runningCommand", { command: shortCommand(activity.detail) });
      }
      if ((activity.toolName === "write" || activity.toolName === "edit") && activity.detail) {
        return t("runProgress.savingFile", { file: activity.detail });
      }
      if (activity.toolName === "read" && activity.detail) {
        return t("runProgress.readingFile", { file: activity.detail });
      }
      return t("runProgress.runningTool", { tool: activity.toolName });
  }
}

/**
 * How long the model has produced nothing, or undefined while a tool runs (the
 * command is busy, not the model) or before the first progress arrives.
 */
export function quietForMs(progress: RunProgress | undefined, now: number): number | undefined {
  if (!progress || progress.activity.kind === "runningTool") return undefined;
  const stepStarted = Date.parse(progress.stepStartedAt);
  const lastOutput = progress.lastOutputAt ? Date.parse(progress.lastOutputAt) : 0;
  return Math.max(0, now - Math.max(stepStarted, lastOutput));
}

/**
 * The live line under the newest message while a turn runs: what the local AI is
 * doing, this step's tokens and speed, and the step and turn times. When the model
 * produces nothing for a while it says so plainly and offers Stop.
 */
export function RunProgressLine({ startedAt }: { readonly startedAt?: string }) {
  const { t, locale } = useTranslation();
  const { progress, onStop, quietNoticeAfterMs } = useContext(RunProgressContext);
  const now = useNow(true);
  const turnMs = startedAt ? Math.max(0, now - Date.parse(startedAt)) : undefined;
  const turnLabel =
    turnMs === undefined
      ? t("runProgress.working")
      : t("runProgress.turnElapsed", { duration: formatDuration(t, Math.max(1000, turnMs)) });

  if (!progress) {
    return (
      <div className="timeline-working" data-testid="timeline-working">
        <span className="timeline-working__label">{turnLabel}</span>
      </div>
    );
  }

  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const stats: string[] = [];
  if (progress.stepTokens > 0) {
    stats.push(t("runProgress.tokens", { count: progress.stepTokens }));
  }
  if (progress.tokensPerSecond !== undefined) {
    stats.push(t("runProgress.speed", { speed: numbers.format(progress.tokensPerSecond) }));
  }
  stats.push(
    t("runProgress.stepElapsed", {
      duration: formatDuration(t, now - Date.parse(progress.stepStartedAt)),
    }),
  );
  stats.push(turnLabel);

  const quietMs = quietForMs(progress, now);
  const quiet = quietMs !== undefined && quietMs >= quietNoticeAfterMs;

  return (
    <div
      className="timeline-working timeline-working--progress"
      data-testid="timeline-working"
      data-activity={progress.activity.kind}
    >
      <span className="timeline-working__label" data-testid="run-progress-activity">
        {describeActivity(t, progress.activity)}
      </span>
      <span className="timeline-working__stats" data-testid="run-progress-stats">
        {stats.join(" · ")}
      </span>
      {quiet ? (
        <div className="timeline-working__quiet" data-testid="run-progress-quiet" role="alert">
          <div className="timeline-working__quiet-copy">
            <span className="timeline-working__quiet-title">
              {t("runProgress.quiet", {
                count: Math.max(1, Math.floor((quietMs ?? 0) / 60_000)),
              })}
            </span>
            <span className="timeline-working__quiet-hint">{t("runProgress.quietHint")}</span>
          </div>
          {onStop ? (
            <button
              className="button button--secondary"
              data-testid="run-progress-stop"
              type="button"
              onClick={onStop}
            >
              {t("runProgress.stop")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
