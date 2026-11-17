import type { ReactNode } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  LocalModelStatus,
  NotificationPreferences,
  ThemePresetId,
  WorkspaceRecord,
} from "../../../contracts/desktop-state";
import type { DesktopNotificationPermissionStatus } from "../../../contracts/ipc";
import { useTranslation } from "../../i18n";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsGeneralSection } from "./settings-general-section";
import { SettingsNotificationsSection } from "./settings-notifications-section";
import { type SettingsSection, settingsSectionDefinition } from "./settings-sections";
import { SettingsShortcutsSection } from "./settings-shortcuts-section";

export type { SettingsSection } from "./settings-sections";

interface SettingsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly section: SettingsSection;
  readonly platform: NodeJS.Platform;
  /** Shown beside the page title, such as the workspace a page edits. */
  readonly headerAccessory?: ReactNode;
  readonly onSelectSection: (section: SettingsSection) => void;
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly integratedTerminalShell: string;
  /** The local model and, when the app runs it, its engine. */
  readonly localModel?: LocalModelStatus;
  readonly themeMode: "system" | "light" | "dark";
  readonly themePresetId: ThemePresetId;
  readonly enableTransparency: boolean;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: "system" | "light" | "dark") => void;
  readonly onSetThemePresetId: (presetId: ThemePresetId) => void;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
}

export function SettingsView({
  workspace,
  runtime,
  section,
  platform,
  headerAccessory,
  onSelectSection,
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  integratedTerminalShell,
  localModel,
  themeMode,
  themePresetId,
  enableTransparency,
  onToggleSkillCommands,
  onSetNotificationPreferences,
  onSetIntegratedTerminalShell,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
  onSetThemeMode,
  onSetThemePresetId,
  onSetEnableTransparency,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const definition = settingsSectionDefinition(section);
  const header = (
    <header className="view-header">
      <div>
        <h1 className="view-header__title">{t(definition.titleKey)}</h1>
        <p className="view-header__body">
          {t(definition.descriptionKey, {
            workspace: workspace?.name ?? t("settings.thisWorkspace"),
          })}
        </p>
      </div>
      {headerAccessory ? <div className="view-header__actions">{headerAccessory}</div> : null}
    </header>
  );

  if (!workspace && definition.needsWorkspace) {
    return (
      <section className="canvas">
        <div className="conversation settings-view">
          {header}
          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row__label">
                <div className="settings-row__title">{t("settings.selectWorkspace.title")}</div>
                <div className="settings-row__description">
                  {t("settings.selectWorkspace.body")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation settings-view">
        {header}

        <div className="settings-grid">
          {section === "appearance" ? (
            <SettingsAppearanceSection
              themeMode={themeMode}
              themePresetId={themePresetId}
              onSetThemeMode={onSetThemeMode}
              onSetThemePresetId={onSetThemePresetId}
              enableTransparency={enableTransparency}
              onSetEnableTransparency={onSetEnableTransparency}
            />
          ) : null}

          {section === "general" ? (
            <SettingsGeneralSection
              runtime={runtime}
              localModel={localModel}
              integratedTerminalShell={integratedTerminalShell}
              onSetIntegratedTerminalShell={onSetIntegratedTerminalShell}
              onToggleSkillCommands={onToggleSkillCommands}
            />
          ) : null}

          {section === "shortcuts" ? <SettingsShortcutsSection platform={platform} /> : null}

          {section === "notifications" ? (
            <SettingsNotificationsSection
              notificationPreferences={notificationPreferences}
              notificationPermissionStatus={notificationPermissionStatus}
              notificationPermissionPending={notificationPermissionPending}
              onSetNotificationPreferences={onSetNotificationPreferences}
              onRequestNotificationPermission={onRequestNotificationPermission}
              onOpenSystemNotificationSettings={onOpenSystemNotificationSettings}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
