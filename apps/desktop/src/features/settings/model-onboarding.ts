import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { LocalModelStatus } from "../../../contracts/desktop-state";
import { buildModelOptions } from "../conversation/composer-commands";

export interface ModelOnboardingNotice {
  readonly title: string;
  readonly description: string;
  /** The engine's last log lines, shown with a crash. */
  readonly logTail?: readonly string[];
  /** The notice offers to restart the app's own engine. */
  readonly canRestart?: boolean;
  /** Starting: the notice is informational, not an error. */
  readonly tone?: "progress" | "error";
}

export interface ModelOnboardingState {
  /** Sending waits until the app knows its local model. */
  readonly requiresModelSelection: boolean;
  readonly notice?: ModelOnboardingNotice;
}

const LOCAL_AI_NOT_RUNNING: ModelOnboardingNotice = {
  title: "The local AI isn't running",
  description:
    "AI Coding at Home can't reach the AI on this computer yet. It may still be starting up; this message goes away as soon as it's ready.",
};

const LOCAL_AI_STARTING: ModelOnboardingNotice = {
  title: "Starting the local AI…",
  description: "Loading the model into memory. This message goes away as soon as it's ready.",
  tone: "progress",
};

function engineNotice(localModel: LocalModelStatus | undefined): ModelOnboardingNotice | undefined {
  const engine = localModel?.engine;
  if (!engine) return undefined;
  if (engine.phase === "crashed") {
    return {
      title: "The local AI stopped",
      description: engine.message ?? "The AI engine stopped unexpectedly.",
      ...(engine.logTail?.length ? { logTail: engine.logTail } : {}),
      canRestart: true,
      tone: "error",
    };
  }
  if (engine.phase === "starting") {
    const note = engine.notes?.[engine.notes.length - 1];
    return note ? { ...LOCAL_AI_STARTING, description: note } : LOCAL_AI_STARTING;
  }
  if (engine.phase === "stopped" && localModel?.reachable === false) {
    return {
      title: "The local AI isn't running",
      description: "The AI engine is stopped.",
      canRestart: true,
      tone: "error",
    };
  }
  return undefined;
}

/**
 * pi at home runs one local model, so there is nothing to pick or connect: the only thing to
 * tell people is that the local AI is not answering (starting, stopped, or not started). When the
 * app runs the engine itself it knows which, and a crash comes with the reason and a Restart.
 */
export function deriveModelOnboardingState(
  runtime: RuntimeSnapshot | undefined,
  localModel: LocalModelStatus | undefined,
): ModelOnboardingState {
  const hasLocalModel = !runtime || buildModelOptions(runtime).length > 0;
  const fromEngine = engineNotice(localModel);
  if (fromEngine && (localModel?.reachable !== true || fromEngine.tone === "error")) {
    return { requiresModelSelection: !hasLocalModel, notice: fromEngine };
  }
  if (localModel?.reachable === false || !hasLocalModel) {
    return { requiresModelSelection: !hasLocalModel, notice: LOCAL_AI_NOT_RUNNING };
  }
  return { requiresModelSelection: false };
}
