import { useState } from "react";
import { useTranslation } from "../../i18n";
import type { ModelOnboardingNotice } from "./model-onboarding";

interface ModelOnboardingNoticeBannerProps {
  readonly notice: ModelOnboardingNotice | undefined;
}

export function ModelOnboardingNoticeBanner({ notice }: ModelOnboardingNoticeBannerProps) {
  const { t } = useTranslation();
  const [restarting, setRestarting] = useState(false);
  const [showLog, setShowLog] = useState(false);
  if (!notice) {
    return null;
  }

  const restart = () => {
    setRestarting(true);
    window.piApp
      ?.restartLocalEngine()
      .finally(() => setRestarting(false))
      .catch((error: unknown) => console.error("[renderer] restartLocalEngine failed", error));
  };

  return (
    <div
      className={`model-onboarding-notice${notice.tone === "error" ? " model-onboarding-notice--error" : ""}`}
      data-testid="model-onboarding-notice"
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <div className="model-onboarding-notice__body">
        <span className="model-onboarding-notice__title">{notice.title}</span>
        <span className="model-onboarding-notice__description">{notice.description}</span>
      </div>
      {notice.logTail?.length ? (
        <button
          type="button"
          className="model-onboarding-notice__action"
          onClick={() => setShowLog((value) => !value)}
        >
          {showLog ? t("engine.notice.hideLog") : t("engine.notice.showLog")}
        </button>
      ) : null}
      {notice.canRestart ? (
        <button
          type="button"
          className="model-onboarding-notice__action"
          data-testid="restart-local-engine"
          disabled={restarting}
          onClick={restart}
        >
          {restarting ? t("engine.notice.restarting") : t("engine.notice.restart")}
        </button>
      ) : null}
      {showLog && notice.logTail?.length ? (
        <pre className="model-onboarding-notice__log">{notice.logTail.join("\n")}</pre>
      ) : null}
    </div>
  );
}
