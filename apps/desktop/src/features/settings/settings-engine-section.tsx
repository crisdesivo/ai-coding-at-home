import { useState } from "react";
import type { LocalModelStatus } from "../../../contracts/desktop-state";
import type { EngineBackend, EngineCudaStatus, LocalEngineStatus } from "../../../contracts/engine";
import { useTranslation, type MessageKey } from "../../i18n";
import { SettingsGroup, SettingsRow } from "./settings-utils";

const STATUS_KEYS: Record<LocalEngineStatus["phase"], MessageKey> = {
  running: "settings.engine.status.running",
  starting: "settings.engine.status.starting",
  crashed: "settings.engine.status.crashed",
  stopped: "settings.engine.status.stopped",
};

const BACKEND_KEYS: Record<EngineBackend, MessageKey> = {
  vulkan: "settings.engine.backend.vulkan",
  cuda: "settings.engine.backend.cuda",
  metal: "settings.engine.backend.metal",
  cpu: "settings.engine.backend.cpu",
};

const CUDA_KEYS: Record<EngineCudaStatus["state"], MessageKey> = {
  downloading: "settings.engine.nvidia.downloading",
  ready: "settings.engine.nvidia.ready",
  "in-use": "settings.engine.nvidia.inUse",
  failed: "settings.engine.nvidia.failed",
  skipped: "settings.engine.nvidia.skipped",
};

function logError(action: string) {
  return (error: unknown) => console.error(`[renderer] ${action} failed`, error);
}

/** The app's own AI engine: model, engine type, port, and what to do when it misbehaves. */
export function SettingsEngineSection({ localModel }: { readonly localModel?: LocalModelStatus }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const engine = localModel?.engine;
  if (!engine) {
    return (
      <SettingsGroup title={t("settings.engine.group")}>
        <SettingsRow
          title={t("settings.engine.external.title")}
          description={t("settings.engine.external.description")}
        >
          <span className="settings-engine__value">{localModel?.name}</span>
        </SettingsRow>
      </SettingsGroup>
    );
  }
  const statusDescription = [engine.message, ...(engine.notes ?? [])].filter(Boolean).join(" ");
  return (
    <SettingsGroup title={t("settings.engine.group")}>
      <SettingsRow title={t("settings.engine.model.title")} description={engine.modelFile}>
        <span className="settings-engine__value" data-testid="settings-engine-model">
          {engine.modelName ?? localModel?.name}
        </span>
      </SettingsRow>
      <SettingsRow
        title={t("settings.engine.status.title")}
        {...(statusDescription ? { description: statusDescription } : {})}
      >
        <span className="settings-engine__value" data-testid="settings-engine-status">
          {t(STATUS_KEYS[engine.phase])}
        </span>
        {engine.phase === "crashed" || engine.phase === "stopped" ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              window.piApp
                ?.restartLocalEngine()
                .finally(() => setBusy(false))
                .catch(logError("restartLocalEngine"));
            }}
          >
            {t("settings.engine.restart.button")}
          </button>
        ) : null}
      </SettingsRow>
      <SettingsRow title={t("settings.engine.backend.title")}>
        <span className="settings-engine__value" data-testid="settings-engine-backend">
          {engine.backend ? t(BACKEND_KEYS[engine.backend]) : null}
        </span>
      </SettingsRow>
      {engine.cuda ? (
        <SettingsRow
          title={t("settings.engine.nvidia.title")}
          {...(engine.cuda.detail ? { description: engine.cuda.detail } : {})}
        >
          <span className="settings-engine__value" data-testid="settings-engine-cuda">
            {t(CUDA_KEYS[engine.cuda.state])}
            {engine.cuda.percent !== undefined ? ` ${engine.cuda.percent}%` : null}
          </span>
        </SettingsRow>
      ) : null}
      <SettingsRow title={t("settings.engine.port.title")}>
        <span className="settings-engine__value">{engine.port}</span>
      </SettingsRow>
      <SettingsRow
        title={t("settings.engine.recheck.title")}
        description={t("settings.engine.recheck.description")}
      >
        <button
          type="button"
          className="button"
          data-testid="settings-engine-recheck"
          onClick={() => {
            window.piApp?.recheckComputer().catch(logError("recheckComputer"));
          }}
        >
          {t("settings.engine.recheck.button")}
        </button>
      </SettingsRow>
      <SettingsRow
        title={t("settings.engine.log.title")}
        description={t("settings.engine.log.description")}
      >
        <button
          type="button"
          className="button"
          onClick={() => {
            window.piApp?.openEngineLog().catch(logError("openEngineLog"));
          }}
        >
          {t("settings.engine.log.button")}
        </button>
      </SettingsRow>
    </SettingsGroup>
  );
}
