import type { ReactNode } from "react";

/* ── Layout components ────────────────────────────────── */

export function SettingsGroup({
  title,
  description,
  plain = false,
  children,
}: {
  readonly title?: string;
  readonly description?: string;
  /** Lay children out without the rounded card, for tiles and other custom content. */
  readonly plain?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="settings-section">
      {title ? <h3 className="settings-section__title">{title}</h3> : null}
      {description ? <p className="settings-section__description">{description}</p> : null}
      {plain ? children : <div className="settings-group">{children}</div>}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <div className="settings-row__title">{title}</div>
        {description ? <div className="settings-row__description">{description}</div> : null}
      </div>
      {children ? <div className="settings-row__control">{children}</div> : null}
    </div>
  );
}
