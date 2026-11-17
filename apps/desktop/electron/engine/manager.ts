import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EngineBackend, EngineCudaStatus, LocalEngineStatus } from "../../contracts/engine";
import { LOCAL_MODEL_CONFIG_ENV, type LocalModelConfig } from "../platform/local-model";
import { CONTEXT_TOKENS } from "./catalog";
import {
  CudaSkipped,
  CudaUnusable,
  installCudaEngine,
  installedCudaServer,
  removeCudaEngine,
} from "./cuda";
import { findServerBinary } from "./locate";
import { killWatchedNow } from "./watchdog";
import { EngineServer, EngineStartError, findFreePort, type ServerPhase } from "./server";

/** Turns the engine manager off: `PI_AT_HOME_ENGINE=off`. */
export const ENGINE_SWITCH_ENV = "PI_AT_HOME_ENGINE";

/**
 * The app runs its own engine unless a hand-written model config is named (the developer's own
 * llama-server), the switch is off, or an automated test drives the app (tests run their own fake
 * model servers; `PI_AT_HOME_ENGINE=on` opts a test in).
 */
export function engineManagerEnabled(env: NodeJS.ProcessEnv): boolean {
  const flag = env[ENGINE_SWITCH_ENV]?.trim().toLowerCase();
  if (flag === "off" || flag === "0") return false;
  if (env[LOCAL_MODEL_CONFIG_ENV]?.trim()) return false;
  if (env.PI_APP_TEST_MODE && flag !== "on") return false;
  return true;
}

export interface InstalledModel {
  readonly id: string;
  readonly name: string;
  /** The quant ("quality setting"), e.g. Q5_K_M. Absent in state written before quants. */
  readonly quant?: string;
  /** The first (or only) GGUF file: what llama-server loads. */
  readonly path: string;
  /** Every part of the model (split GGUFs have several). */
  readonly files?: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256?: string;
  }[];
  /** Total size of all parts. */
  readonly sizeBytes: number;
  readonly reasoning: boolean;
  readonly maxTokens: number;
}

export interface EngineState {
  readonly version: 1;
  readonly model?: InstalledModel;
  readonly port?: number;
  /** Which bundled build runs the model (Vulkan, Metal, or CPU-only on a PC without a GPU). */
  readonly bundledBackend?: EngineBackend;
  readonly hasNvidia?: boolean;
  readonly cuda?: {
    readonly status: "ready" | "failed" | "skipped";
    readonly reason?: string;
  };
  readonly lastPid?: number;
}

export interface EngineManagerOptions {
  readonly userDataDir: string;
  readonly bundledEngineRoot: string;
  /** Called on every status change, for the main window. */
  readonly onStatus?: (status: LocalEngineStatus) => void;
}

/**
 * Owns the engine's files (<userData>/models, <userData>/engine) and the llama-server process.
 */
export class EngineManager {
  readonly modelsDir: string;
  readonly engineDir: string;
  readonly logPath: string;
  private readonly statePath: string;
  private state: EngineState = { version: 1 };
  readonly server: EngineServer;
  private backend: EngineBackend | undefined;
  private notes: string[] = [];
  private cuda: EngineCudaStatus | undefined;
  private cudaRun: Promise<void> | undefined;
  private cudaAbort: AbortController | undefined;
  private serverPath: string | undefined;

  constructor(private readonly options: EngineManagerOptions) {
    this.modelsDir = path.join(options.userDataDir, "models");
    this.engineDir = path.join(options.userDataDir, "engine");
    this.statePath = path.join(this.engineDir, "state.json");
    this.logPath = path.join(this.engineDir, "engine.log");
    this.server = new EngineServer({
      onPhase: (phase) => this.onServerPhase(phase),
      // Remembered so a server left behind by a crashed app can be stopped next launch.
      onSpawn: (pid) => {
        this.save({ lastPid: pid }).catch(() => undefined);
        this.emit();
      },
    });
  }

  get current(): EngineState {
    return this.state;
  }

  bundledServerPath(): string | undefined {
    return findServerBinary(this.options.bundledEngineRoot);
  }

  async load(): Promise<void> {
    await mkdir(this.engineDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as EngineState;
      if (parsed && parsed.version === 1) this.state = parsed;
    } catch {
      this.state = { version: 1 };
    }
    await this.killStaleServer();
  }

  private saving: Promise<void> = Promise.resolve();

  /** Updates engine/state.json; writes run one at a time so none is lost. */
  save(patch: Partial<EngineState>): Promise<void> {
    this.state = { ...this.state, ...patch, version: 1 };
    const snapshot = this.state;
    const write = async () => {
      await mkdir(this.engineDir, { recursive: true });
      const temp = `${this.statePath}.tmp`;
      await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await rename(temp, this.statePath);
    };
    this.saving = this.saving.then(write, write);
    return this.saving;
  }

  /** The model is downloaded and in place: no setup needed. */
  async hasInstalledModel(): Promise<boolean> {
    const model = this.state.model;
    if (!model) return false;
    const files = model.files ?? [{ path: model.path, sizeBytes: model.sizeBytes }];
    for (const file of files) {
      const info = await stat(file.path).catch(() => undefined);
      if (!info || info.size !== file.sizeBytes) return false;
    }
    return files.length > 0;
  }

  /** Where a downloaded model file lives: <userData>/models/<name>. */
  modelPathFor(fileName: string): string {
    return path.join(this.modelsDir, path.basename(fileName));
  }

  localModelConfig(port: number, model: InstalledModel): LocalModelConfig {
    return {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      modelId: model.id,
      name: model.name,
      contextWindow: CONTEXT_TOKENS,
      reasoning: model.reasoning,
      maxTokens: model.maxTokens,
    };
  }

  async writeLocalModelConfig(configPath: string, config: LocalModelConfig): Promise<void> {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  /**
   * Picks a port (last launch's when still free), writes local-model.json and starts the engine,
   * returning at once; the server loads the model in the background. Starts the CUDA build when it
   * is installed, falling back to the bundled one if that fails.
   */
  async startInBackground(configPath: string): Promise<LocalModelConfig> {
    const model = this.state.model;
    if (!model) throw new Error("No model is installed yet.");
    const port = await findFreePort(this.state.port);
    const config = this.localModelConfig(port, model);
    await this.writeLocalModelConfig(configPath, config);
    await this.save({ port });
    void this.startServer(model, port).catch((error: unknown) => {
      console.error("[engine] start failed", error);
    });
    return config;
  }

  /** Starts the server and resolves when it answers (or rejects with a plain reason). */
  async startServer(
    model: InstalledModel,
    port: number,
    onWaiting?: (elapsedMs: number) => void,
  ): Promise<void> {
    const bundled = this.bundledServerPath();
    const cudaServer =
      this.state.cuda?.status === "ready" ? await installedCudaServer(this.engineDir) : undefined;
    if (cudaServer) {
      try {
        await this.launch(cudaServer, "cuda", model, port, onWaiting);
        this.cuda = { state: "in-use" };
        this.emit();
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.notes = [
          ...this.notes,
          `The faster NVIDIA engine didn't start, so the standard engine is used instead. ${reason}`,
        ];
        await this.save({ cuda: { status: "failed", reason } });
        await removeCudaEngine(this.engineDir).catch(() => undefined);
        this.cuda = { state: "failed", detail: reason };
        this.emit();
      }
    }
    if (!bundled) {
      const reason =
        "The AI engine is missing from this installation. Please reinstall AI Coding at Home.";
      this.backend = undefined;
      this.failWithoutServer(reason);
      throw new EngineStartError(reason, []);
    }
    await this.launch(
      bundled,
      this.state.bundledBackend ?? defaultBackend(),
      model,
      port,
      onWaiting,
    );
  }

  private failedReason: string | undefined;

  private failWithoutServer(reason: string): void {
    this.failedReason = reason;
    this.emit();
  }

  private async launch(
    serverPath: string,
    backend: EngineBackend,
    model: InstalledModel,
    port: number,
    onWaiting?: (elapsedMs: number) => void,
  ): Promise<void> {
    this.backend = backend;
    this.serverPath = serverPath;
    this.failedReason = undefined;
    this.emit();
    await this.server.start(
      { serverPath, modelPath: model.path, modelId: model.id, port, logFile: this.logPath },
      onWaiting,
    );
  }

  /** Restart from the banner or Settings: a new attempt with the counter reset. */
  async restart(): Promise<void> {
    const model = this.state.model;
    if (!model || !this.state.port) return;
    this.notes = [];
    await this.startServer(model, this.state.port).catch((error: unknown) => {
      console.error("[engine] restart failed", error);
    });
  }

  async stop(): Promise<void> {
    this.cudaAbort?.abort();
    await this.server.stop();
  }

  stopNow(): void {
    this.cudaAbort?.abort();
    this.server.stopNow();
  }

  private onServerPhase(_phase: ServerPhase): void {
    this.emit();
  }

  status(): LocalEngineStatus {
    const phase = this.failedReason ? "crashed" : this.server.currentPhase;
    const reason = this.failedReason ?? this.server.reason;
    const model = this.state.model;
    return {
      phase,
      ...(this.backend ? { backend: this.backend } : {}),
      ...(this.state.port ? { port: this.state.port } : {}),
      ...(this.server.pid ? { pid: this.server.pid } : {}),
      ...(model ? { modelName: model.name, modelFile: model.path } : {}),
      ...(phase === "crashed" && reason ? { message: reason } : {}),
      ...(phase === "crashed" ? { logTail: this.server.logTail(20) } : {}),
      ...(this.notes.length > 0 ? { notes: [...this.notes] } : {}),
      ...(this.cuda ? { cuda: this.cuda } : {}),
      logPath: this.logPath,
    };
  }

  private emit(): void {
    this.options.onStatus?.(this.status());
  }

  /**
   * NVIDIA on Windows/Linux: fetch the CUDA build in the background for the next launch. Skipped
   * (with a note) when the disk is too full; never blocks or breaks the running engine.
   */
  startCudaDownloadIfUseful(): void {
    if (this.cudaRun) return;
    if (!this.state.hasNvidia) return;
    if (process.platform !== "win32" && process.platform !== "linux") return;
    if (this.state.cuda?.status === "failed") {
      this.cuda = {
        state: "failed",
        ...(this.state.cuda.reason ? { detail: this.state.cuda.reason } : {}),
      };
      this.emit();
      return;
    }
    if (this.state.cuda?.status === "ready") {
      if (this.backend !== "cuda") {
        this.cuda = { state: "ready", detail: "Used from the next time you open the app." };
        this.emit();
      }
      return;
    }
    this.cudaAbort = new AbortController();
    this.cuda = { state: "downloading", detail: "Getting the faster NVIDIA engine…" };
    this.emit();
    this.cudaRun = installCudaEngine({
      engineDir: this.engineDir,
      signal: this.cudaAbort.signal,
      onProgress: (text, percent) => {
        this.cuda = {
          state: "downloading",
          detail: text,
          ...(percent !== undefined ? { percent: Math.round(percent) } : {}),
        };
        this.emit();
      },
    })
      .then(async () => {
        await this.save({ cuda: { status: "ready" } });
        this.cuda = { state: "ready", detail: "Used from the next time you open the app." };
      })
      .catch(async (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        if (error instanceof CudaSkipped) {
          this.cuda = { state: "skipped", detail: reason };
          await this.save({ cuda: { status: "skipped", reason } }).catch(() => undefined);
        } else if (error instanceof CudaUnusable) {
          // Downloaded but can't run here: free the space and don't download it again.
          this.cuda = { state: "failed", detail: reason };
          await this.save({ cuda: { status: "failed", reason } }).catch(() => undefined);
          await removeCudaEngine(this.engineDir).catch(() => undefined);
        } else if (this.cudaAbort?.signal.aborted) {
          this.cuda = undefined;
        } else {
          // A download problem is tried again next launch; nothing is saved as failed.
          this.cuda = { state: "failed", detail: `Couldn't get the NVIDIA engine: ${reason}` };
        }
      })
      .finally(() => {
        this.cudaRun = undefined;
        this.emit();
      });
  }

  /** Forget a failed or skipped CUDA attempt (Re-check my computer). */
  async resetCuda(): Promise<void> {
    if (this.state.cuda?.status !== "ready") {
      const { cuda: _drop, ...rest } = this.state;
      this.state = rest;
      await this.save({});
    }
  }

  private async killStaleServer(): Promise<void> {
    const pid = this.state.lastPid;
    if (!pid || pid === process.pid) return;
    if (await isOurServer(pid, this.modelsDir)) {
      // Its process group (watchdog and server), and the process itself (checked to be ours).
      console.warn(`[engine] stopping a llama-server (pid ${pid}) left over from an earlier run`);
      killWatchedNow(pid);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  get activeServerPath(): string | undefined {
    return this.serverPath;
  }
}

function defaultBackend(): EngineBackend {
  return process.platform === "darwin" ? "metal" : "vulkan";
}

/** Whether `pid` is a llama-server this app started (its command line names our models folder). */
async function isOurServer(pid: number, modelsDir: string): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const commandLine = await new Promise<string>((resolve) => {
    if (process.platform === "linux") {
      readFile(`/proc/${pid}/cmdline`, "utf8")
        .then((text) => resolve(text.replace(/\0/g, " ")))
        .catch(() => resolve(""));
    } else if (process.platform === "darwin") {
      execFile("ps", ["-p", String(pid), "-o", "command="], (error, stdout) =>
        resolve(error ? "" : String(stdout)),
      );
    } else {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
        ],
        { windowsHide: true, timeout: 15_000 },
        (error, stdout) => resolve(error ? "" : String(stdout)),
      );
    }
  });
  return /llama-server/i.test(commandLine) && commandLine.includes(modelsDir);
}
