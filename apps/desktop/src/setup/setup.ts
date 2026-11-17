import type { SetupApi, SetupProgress, SetupView } from "../../contracts/engine";
import "./setup.css";

declare global {
  interface Window {
    piSetup?: SetupApi;
  }
}

const root = document.getElementById("setup");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bytes(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
  if (value >= 1e6) return `${Math.round(value / 1e6)} MB`;
  if (value >= 1e3) return `${Math.round(value / 1e3)} KB`;
  return `${value} B`;
}

function speed(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB/s`;
  if (value >= 1e3) return `${Math.round(value / 1e3)} KB/s`;
  return `${Math.round(value)} B/s`;
}

function timeLeft(seconds: number): string {
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${minutes % 60} min left`;
}

function progressHtml(progress: SetupProgress): string {
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, (progress.receivedBytes / progress.totalBytes) * 100)
      : 0;
  const parts = [
    `<strong>${escapeHtml(progress.label)} · ${percent.toFixed(0)}%</strong>`,
    progress.totalBytes > 0
      ? `${bytes(progress.receivedBytes)} of ${bytes(progress.totalBytes)}`
      : bytes(progress.receivedBytes),
  ];
  const right: string[] = [];
  if (progress.label.startsWith("Downloading")) {
    if (progress.stalledSeconds !== undefined) right.push("waiting for data…");
    else if (progress.bytesPerSecond > 0) right.push(speed(progress.bytesPerSecond));
    else right.push("measuring speed…");
    if (progress.etaSeconds !== undefined && progress.stalledSeconds === undefined) {
      right.push(timeLeft(progress.etaSeconds));
    }
  }
  return `<div class="card" data-testid="setup-progress">
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(0)}"><div style="width:${percent.toFixed(1)}%"></div></div>
    <div class="progress-line"><span>${parts.join(" · ")}</span><span>${right.join(" · ")}</span></div>
  </div>`;
}

function render(view: SetupView): void {
  if (!root) return;
  document.title = view.mode === "first-run" ? "Setup" : "Check computer";
  const steps = view.steps
    .map((step) => {
      const mark = step.status === "done" ? "✓" : step.status === "error" ? "!" : "";
      return `<li class="step ${step.status}" data-step="${step.id}" data-status="${step.status}"><span class="dot" aria-hidden="true">${mark}</span>${escapeHtml(step.label)}</li>`;
    })
    .join("");
  const stalled = view.progress?.stalledSeconds !== undefined;
  const sections: string[] = [
    `<header>
      <div class="eyebrow">AI Coding at Home</div>
      <h1 class="${view.done ? "ready" : ""}" data-testid="setup-headline">${escapeHtml(view.headline)}</h1>
      ${view.subline ? `<p class="subline ${stalled ? "warn" : ""}" data-testid="setup-subline">${escapeHtml(view.subline)}</p>` : ""}
    </header>`,
    `<ol class="steps">${steps}</ol>`,
  ];
  if (view.computer) {
    sections.push(`<section class="card" data-testid="setup-computer">
      <div class="card-label">Your computer</div>
      <div class="card-value">${escapeHtml(view.computer)}</div>
    </section>`);
  }
  if (view.model) {
    const notes = view.model.notes.length
      ? `<ul class="notes">${view.model.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
      : "";
    sections.push(`<section class="card" data-testid="setup-model">
      <div class="card-label">AI model</div>
      <div class="card-value">${escapeHtml(view.model.name)} · ${escapeHtml(view.model.size)}</div>
      ${notes}
      ${view.model.details ? `<p class="details">${escapeHtml(view.model.details)}</p>` : ""}
    </section>`);
  }
  if (view.progress) {
    sections.push(progressHtml(view.progress));
  }
  if (view.error) {
    const details = view.error.details?.length
      ? `<pre>${escapeHtml(view.error.details.join("\n"))}</pre>`
      : "";
    sections.push(`<section class="error-card" role="alert" data-testid="setup-error">
      <h2>${escapeHtml(view.error.title)}</h2>
      <p>${escapeHtml(view.error.reason)}</p>
      ${details}
    </section>`);
  }
  if (view.actions.length) {
    sections.push(
      `<div class="actions">${view.actions
        .map(
          (action) =>
            `<button type="button" class="${action.primary ? "primary" : ""}" data-action="${action.id}">${escapeHtml(action.label)}</button>`,
        )
        .join("")}</div>`,
    );
  }
  root.innerHTML = sections.join("");
  const primary = root.querySelector<HTMLButtonElement>("button.primary");
  primary?.focus();
}

root?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  const id = target?.dataset.action;
  if (!id || !window.piSetup) return;
  window.piSetup.action(id as Parameters<SetupApi["action"]>[0]).catch((error: unknown) => {
    console.error("[setup] action failed", error);
  });
});

const api = window.piSetup;
if (api) {
  api.onView(render);
  api
    .getView()
    .then((view) => {
      if (view) render(view);
    })
    .catch((error: unknown) => console.error("[setup] getView failed", error));
}
