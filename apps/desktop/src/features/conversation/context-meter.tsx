import { useId, useState } from "react";
import type { SessionUsageSnapshot } from "@pi-gui/session-driver";

interface ContextMeterProps {
  readonly usage: SessionUsageSnapshot | undefined;
}

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Context ring beside the model name. Hovering or focusing it shows how much of the local
 * model's context window the thread uses; the local model costs nothing and has no plan limits.
 */
export function ContextMeter({ usage }: ContextMeterProps) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const context = usage?.context;
  if (!usage || !context) return null;

  const percent = context.tokens === null ? null : (context.tokens / context.contextWindow) * 100;
  const tone =
    percent === null ? "unknown" : percent > 90 ? "danger" : percent > 70 ? "warning" : "normal";
  const label =
    percent === null
      ? "Context window: usage unknown until the next reply"
      : `Context window: ${formatPercent(percent)} used`;

  return (
    <div
      className="context-meter"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="context-meter__ring"
        data-tone={tone}
        aria-label={label}
        aria-describedby={open ? cardId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle className="context-meter__track" cx="8" cy="8" r={RING_RADIUS} />
          <circle
            className="context-meter__fill"
            cx="8"
            cy="8"
            r={RING_RADIUS}
            strokeDasharray={`${(Math.min(percent ?? 0, 100) / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
      </button>
      {open ? (
        <div className="context-meter__card" id={cardId} role="tooltip">
          <section className="context-meter__section">
            <h3 className="context-meter__heading">Context window</h3>
            <p className="context-meter__headline">
              {context.tokens === null || percent === null
                ? `Unknown until the next reply · ${formatTokens(context.contextWindow)} window`
                : `${formatPercent(percent)} used · ${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)} tokens`}
            </p>
            <p className="context-meter__note">
              {context.compactAtTokens === undefined
                ? "Automatic compaction is off"
                : `Compacts automatically at ${formatPercent((context.compactAtTokens / context.contextWindow) * 100)}`}
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(1))}M`;
  }
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
