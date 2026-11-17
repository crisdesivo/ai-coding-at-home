/**
 * The local AI engine (llama.cpp's llama-server) that the app sets up and runs itself: what the
 * main window shows about it, and what the first-run Setup window shows while it gets ready.
 */

/** Which llama.cpp build runs the model. */
export type EngineBackend = "vulkan" | "cuda" | "metal" | "cpu";

/** The faster NVIDIA engine, downloaded in the background after the first setup. */
export interface EngineCudaStatus {
  readonly state: "downloading" | "ready" | "in-use" | "failed" | "skipped";
  /** Plain-language detail: progress, why it was skipped, why it failed. */
  readonly detail?: string;
  readonly percent?: number;
}

export interface LocalEngineStatus {
  /** `starting` until the server answers; `crashed` once it stopped and won't be restarted. */
  readonly phase: "starting" | "running" | "crashed" | "stopped";
  readonly backend?: EngineBackend;
  readonly port?: number;
  /** The server's process id while it runs. */
  readonly pid?: number;
  readonly modelName?: string;
  readonly modelFile?: string;
  /** Why the engine stopped, in plain words. */
  readonly message?: string;
  /** The last lines the engine wrote, shown with a crash. */
  readonly logTail?: readonly string[];
  /** Things worth telling, such as "the NVIDIA engine didn't start, so the standard one is used". */
  readonly notes?: readonly string[];
  readonly cuda?: EngineCudaStatus;
  readonly logPath?: string;
}

export type SetupStepId = "check" | "choose" | "download" | "start";
export type SetupStepStatus = "pending" | "active" | "done" | "error";

export interface SetupStep {
  readonly id: SetupStepId;
  readonly label: string;
  readonly status: SetupStepStatus;
}

export interface SetupProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly bytesPerSecond: number;
  /** Seconds left at the current speed; absent until the speed is known. */
  readonly etaSeconds?: number;
  /** Set when no data arrived for a while, so the screen can say so. */
  readonly stalledSeconds?: number;
  /** What is happening, for instance "Downloading" or "Checking the file". */
  readonly label: string;
}

export interface SetupAction {
  readonly id: "retry" | "quit" | "close" | "switch" | "restart-app" | "open-log";
  readonly label: string;
  readonly primary?: boolean;
}

export interface SetupError {
  readonly title: string;
  readonly reason: string;
  /** Extra lines, such as the engine's last log lines. */
  readonly details?: readonly string[];
}

/** Everything the Setup window shows; main sends a new one on every change. */
export interface SetupView {
  readonly mode: "first-run" | "recheck";
  readonly headline: string;
  readonly subline?: string;
  readonly steps: readonly SetupStep[];
  /** "NVIDIA GeForce RTX 3050 Laptop GPU (4 GB) · 38 GB memory". */
  readonly computer?: string;
  readonly model?: {
    readonly name: string;
    readonly size: string;
    readonly notes: readonly string[];
    /** Small print: the quant ("quality setting") and the memory it needs. */
    readonly details?: string;
  };
  readonly progress?: SetupProgress;
  readonly error?: SetupError;
  readonly done?: boolean;
  readonly actions: readonly SetupAction[];
}

export const setupIpc = {
  view: "pi-at-home:setup-view",
  getView: "pi-at-home:setup-get-view",
  action: "pi-at-home:setup-action",
} as const;

export interface SetupApi {
  getView(): Promise<SetupView>;
  action(id: SetupAction["id"]): Promise<void>;
  onView(listener: (view: SetupView) => void): () => void;
}
