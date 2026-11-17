/**
 * How long a running turn may go without new output from the model before the
 * working line says so. Tests shorten it with {@link QUIET_NOTICE_ENV_VAR}.
 */
export const QUIET_NOTICE_AFTER_MS = 60_000;

/** Environment variable (read by the preload) that overrides {@link QUIET_NOTICE_AFTER_MS}. */
export const QUIET_NOTICE_ENV_VAR = "PI_APP_QUIET_NOTICE_AFTER_MS";

/** The quiet-notice threshold from an environment value; the default for anything else. */
export function quietNoticeAfterMs(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : QUIET_NOTICE_AFTER_MS;
}
