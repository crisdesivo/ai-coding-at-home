import type { TimelineActivity, TimelineRunFailureKind } from "../../../contracts/timeline-types";
import { useTranslation, type MessageKey } from "../../i18n";

/** What the newest failure card can do; older cards only explain what happened. */
export interface RunFailureActions {
  /** A reply, a summary or a retry is under way: the buttons wait for it. */
  readonly busy: boolean;
  /** Sends the last message again, summarizing older messages first when `compact` is set. */
  readonly retry: (options: { readonly compact: boolean }) => void;
  /** Clear conversation: the thread goes to Archived and a new one opens on the same folder. */
  readonly startFresh: () => void;
}

type FailureButton = "summarize" | "retry" | "startFresh";

const COPY: Record<
  TimelineRunFailureKind,
  { readonly title: MessageKey; readonly body: MessageKey; readonly buttons: FailureButton[] }
> = {
  "out-of-room": {
    title: "runFailure.outOfRoom.title",
    body: "runFailure.outOfRoom.body",
    buttons: ["summarize", "startFresh"],
  },
  // Summarizing already failed, so starting fresh comes first.
  "compaction-failed": {
    title: "runFailure.compactionFailed.title",
    body: "runFailure.compactionFailed.body",
    buttons: ["startFresh", "summarize"],
  },
  "no-reply": {
    title: "runFailure.noReply.title",
    body: "runFailure.noReply.body",
    buttons: ["retry", "summarize", "startFresh"],
  },
  unreachable: {
    title: "runFailure.unreachable.title",
    body: "runFailure.unreachable.body",
    buttons: ["retry"],
  },
  "model-error": {
    title: "runFailure.modelError.title",
    body: "runFailure.modelError.body",
    buttons: ["retry", "startFresh"],
  },
};

const BUTTON_LABEL: Record<FailureButton, MessageKey> = {
  summarize: "runFailure.summarizeAndRetry",
  retry: "runFailure.retry",
  startFresh: "runFailure.startFresh",
};

/** A turn that ended without a usable reply, in plain words, with what to do next. */
export function RunFailureCard({
  item,
  failure,
  actions,
}: {
  readonly item: TimelineActivity;
  readonly failure: TimelineRunFailureKind;
  readonly actions?: RunFailureActions;
}) {
  const { t } = useTranslation();
  const copy = COPY[failure];
  const run = (button: FailureButton) => {
    if (!actions || actions.busy) return;
    if (button === "startFresh") actions.startFresh();
    else actions.retry({ compact: button === "summarize" });
  };
  return (
    <div
      className="run-failure-card"
      data-testid="run-failure-card"
      data-failure-kind={failure}
      role="alert"
    >
      <p className="run-failure-card__title">{t(copy.title)}</p>
      {actions ? <p className="run-failure-card__body">{t(copy.body)}</p> : null}
      <p className="run-failure-card__details">
        {t("runFailure.details", { message: item.label })}
      </p>
      {actions ? (
        <div className="run-failure-card__actions">
          {copy.buttons.map((button, index) => (
            <button
              className={`button ${index === 0 ? "button--primary" : "button--ghost"}`}
              data-testid={`run-failure-${button}`}
              disabled={actions.busy}
              key={button}
              type="button"
              onClick={() => run(button)}
            >
              {t(BUTTON_LABEL[button])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
