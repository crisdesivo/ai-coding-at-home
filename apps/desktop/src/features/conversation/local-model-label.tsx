import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

/** Names the one local model every thread runs on. There is nothing to choose, so it is plain text. */
export function LocalModelLabel({ runtime }: { readonly runtime: RuntimeSnapshot | undefined }) {
  const model = runtime?.models[0];
  if (!model) {
    return null;
  }
  return (
    <span
      className="model-selector__badge extension-flags__badge--readonly"
      data-testid="local-model-label"
      title={model.modelId}
    >
      {model.label}
    </span>
  );
}
