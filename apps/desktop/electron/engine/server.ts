import { execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { rename } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { CONTEXT_TOKENS } from "./catalog";
import { engineSpawnEnv } from "./locate";
import { killWatchedNow, spawnWatched } from "./watchdog";

export interface ServerLaunch {
  readonly serverPath: string;
  readonly modelPath: string;
  readonly modelId: string;
  readonly port: number;
  readonly logFile?: string;
}

export function serverArgs(launch: Pick<ServerLaunch, "modelPath" | "modelId" | "port">): string[] {
  return [
    "--jinja",
    "-c",
    String(CONTEXT_TOKENS),
    "-np",
    "1",
    "-ctk",
    "q8_0",
    "-ctv",
    "q8_0",
    "-fa",
    "on",
    "--fit",
    "on",
    "--host",
    "127.0.0.1",
    "--port",
    String(launch.port),
    "--alias",
    launch.modelId,
    "-m",
    launch.modelPath,
  ];
}

/** A port nothing listens on, preferring `preferred` when it is free. */
export async function findFreePort(preferred?: number): Promise<number> {
  const tryListen = (port: number) =>
    new Promise<number | undefined>((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => resolve(undefined));
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        const address = server.address();
        const chosen = typeof address === "object" && address ? address.port : undefined;
        server.close(() => resolve(chosen));
      });
    });
  if (preferred && preferred > 0) {
    const port = await tryListen(preferred);
    if (port) return port;
  }
  const port = await tryListen(0);
  if (!port) {
    throw new Error("Couldn't find a free network port on this computer for the AI engine.");
  }
  return port;
}

const LOG_LINES = 200;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** The last lines the engine wrote. */
export class LogRing {
  private readonly lines: string[] = [];
  private partial = "";
  constructor(private readonly max = LOG_LINES) {}
  push(text: string): string[] {
    const parts = (this.partial + text).replace(ANSI, "").split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    const added = parts.filter((line) => line.trim().length > 0);
    for (const line of added) {
      this.lines.push(line);
      if (this.lines.length > this.max) this.lines.shift();
    }
    return added;
  }
  /** Lines written since the last start, for explaining why that run failed. */
  sinceLastStart(count = 40): string[] {
    const all = this.tail();
    let start = 0;
    all.forEach((line, index) => {
      if (line.startsWith("[app] starting")) start = index;
    });
    return all.slice(start).slice(-count);
  }

  tail(count = this.max): string[] {
    const all = this.partial.trim() ? [...this.lines, this.partial] : [...this.lines];
    return all.slice(-count);
  }
  clear(): void {
    this.lines.length = 0;
    this.partial = "";
  }
}

function signalFromExitCode(code: number | null): string | undefined {
  if (code === null || code <= 128 || code >= 160) return undefined;
  const number = code - 128;
  return Object.entries(os.constants.signals).find(([, value]) => value === number)?.[0];
}

/** A plain-language reason for an engine failure, from its last log lines. */
export function explainEngineFailure(
  lines: readonly string[],
  exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null },
): string {
  const text = lines.join("\n");
  if (
    /out of memory|cudaMalloc failed|failed to allocate|ErrorOutOfDeviceMemory|unable to allocate|insufficient memory/i.test(
      text,
    )
  ) {
    return "The computer ran out of memory while loading the model. Close other big programs (games, browsers with many tabs) and press Restart.";
  }
  if (/GLIBC_[\d.]+'? not found/.test(text)) {
    return "This engine needs a newer version of the operating system (its glibc is too old).";
  }
  if (
    /error while loading shared libraries|cannot open shared object|\.dll was not found|Library not loaded/i.test(
      text,
    )
  ) {
    return "The AI engine is missing some of its files. Reinstalling the app should fix this.";
  }
  if (/address already in use|couldn't bind|bind failed|failed to listen/i.test(text)) {
    return "Another program is using the engine's network port. Press Restart to try another port.";
  }
  if (
    /failed to load model|error loading model|invalid magic|gguf_init_from_file|failed to read/i.test(
      text,
    )
  ) {
    return "The model file couldn't be loaded; it may be damaged. Use Re-check my computer in Settings to download it again.";
  }
  if (/vk::|Vulkan|ggml_vulkan.*error|CUDA error|cuda.*error/i.test(text) && exit.code !== 0) {
    return "The graphics driver reported an error. Updating your graphics driver may help; press Restart to try again.";
  }
  if (exit.code === 127) {
    return "The AI engine's program is missing. Reinstalling AI Coding at Home should fix this.";
  }
  if (exit.code === 126) {
    return "The AI engine's program can't be run (no permission). Reinstalling AI Coding at Home should fix this.";
  }
  // The POSIX watchdog reports a server killed by a signal as 128 + the signal number.
  const signal = exit.signal ?? signalFromExitCode(exit.code);
  if (signal) {
    return `The AI engine was stopped by the system (${signal}). Press Restart to start it again.`;
  }
  return `The AI engine stopped unexpectedly (exit code ${exit.code ?? "unknown"}). Press Restart to start it again.`;
}

export class EngineStartError extends Error {
  constructor(
    message: string,
    readonly logTail: readonly string[],
  ) {
    super(message);
    this.name = "EngineStartError";
  }
}

export type ServerPhase = "stopped" | "starting" | "running" | "crashed";

export interface EngineServerEvents {
  readonly onPhase?: (phase: ServerPhase, detail?: { readonly reason?: string }) => void;
  readonly onLog?: (lines: readonly string[]) => void;
  /** Every new process, including the automatic restart. */
  readonly onSpawn?: (pid: number) => void;
}

type HealthFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number }>;

/**
 * One llama-server process: start, wait until it answers /health, restart it once if it crashes
 * later, and stop it when the app quits.
 */
export class EngineServer {
  private child: ChildProcess | undefined;
  private readonly ring = new LogRing();
  private log: WriteStream | undefined;
  private launch: ServerLaunch | undefined;
  private phase: ServerPhase = "stopped";
  private stopping = false;
  private restartsLeft = 1;
  private lastReason: string | undefined;

  constructor(
    private readonly events: EngineServerEvents = {},
    private readonly options: {
      readonly healthTimeoutMs?: number;
      readonly fetch?: HealthFetch;
    } = {},
  ) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get currentPhase(): ServerPhase {
    return this.phase;
  }

  get reason(): string | undefined {
    return this.lastReason;
  }

  logTail(count = LOG_LINES): string[] {
    return this.ring.tail(count);
  }

  private setPhase(phase: ServerPhase, reason?: string): void {
    this.phase = phase;
    this.lastReason = reason;
    this.events.onPhase?.(phase, reason ? { reason } : undefined);
  }

  /**
   * Starts the server and resolves once it answers. Rejects with an EngineStartError (a plain
   * reason + the log tail) if it exits or never becomes ready. `onWaiting` ticks every second.
   */
  async start(launch: ServerLaunch, onWaiting?: (elapsedMs: number) => void): Promise<void> {
    await this.stop();
    this.launch = launch;
    this.restartsLeft = 1;
    await this.spawnAndWait(onWaiting);
  }

  /** Starts again with the same settings, as Restart does. */
  async restart(onWaiting?: (elapsedMs: number) => void): Promise<void> {
    if (!this.launch) {
      throw new Error("The AI engine was never started.");
    }
    await this.stop();
    this.restartsLeft = 1;
    await this.spawnAndWait(onWaiting);
  }

  private async openLog(): Promise<void> {
    this.log?.end();
    this.log = undefined;
    const logFile = this.launch?.logFile;
    if (!logFile) return;
    await rename(logFile, `${logFile}.previous`).catch(() => undefined);
    this.log = createWriteStream(logFile, { flags: "a" });
    this.log.on("error", () => {
      this.log = undefined;
    });
  }

  private record(text: string): void {
    const added = this.ring.push(text);
    this.log?.write(text);
    if (added.length > 0) this.events.onLog?.(added);
  }

  private async spawnAndWait(onWaiting?: (elapsedMs: number) => void): Promise<void> {
    const launch = this.launch;
    if (!launch) return;
    await this.openLog();
    this.stopping = false;
    this.setPhase("starting");
    this.record(`[app] starting ${launch.serverPath} ${serverArgs(launch).join(" ")}\n`);
    const { cwd, env } = engineSpawnEnv(launch.serverPath);
    let child: ChildProcess;
    try {
      // Under a watchdog, so the server dies with the app even if the app is killed hard.
      child = spawnWatched(launch.serverPath, serverArgs(launch), { cwd, env });
    } catch (error) {
      const reason = `The AI engine couldn't be started: ${String(error)}`;
      this.setPhase("crashed", reason);
      throw new EngineStartError(reason, this.ring.tail(30));
    }
    this.child = child;
    if (child.pid) this.events.onSpawn?.(child.pid);
    child.stdout?.on("data", (chunk: Buffer) => this.record(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => this.record(chunk.toString("utf8")));

    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let spawnError: Error | undefined;
    const exitPromise = new Promise<void>((resolve) => {
      child.once("error", (error) => {
        spawnError = error;
        resolve();
      });
      child.once("exit", (code, signal) => {
        exited = { code, signal };
        resolve();
      });
    });
    exitPromise
      .then(() => this.onExit(child, exited, spawnError))
      .catch((error: unknown) => console.error("[engine] exit handling failed", error));

    const started = Date.now();
    const timeoutMs = this.options.healthTimeoutMs ?? 15 * 60_000;
    const healthFetch: HealthFetch =
      this.options.fetch ?? ((url, init) => fetch(url, init).then((response) => response));
    const url = `http://127.0.0.1:${launch.port}/health`;
    while (true) {
      if (spawnError || exited) {
        const reason = spawnError
          ? `The AI engine couldn't be started: ${spawnError.message}`
          : explainEngineFailure(
              this.ring.sinceLastStart(40),
              exited ?? { code: null, signal: null },
            );
        throw new EngineStartError(reason, this.ring.tail(30));
      }
      if (this.child !== child) {
        throw new EngineStartError("The AI engine was stopped while starting.", this.ring.tail(30));
      }
      try {
        const response = await healthFetch(url, { signal: AbortSignal.timeout(2_000) });
        if (response.status === 200) break;
      } catch {
        // not listening yet
      }
      const elapsed = Date.now() - started;
      if (elapsed > timeoutMs) {
        const reason = `The AI engine didn't become ready within ${Math.round(timeoutMs / 60_000)} minutes.`;
        this.killChild(child);
        this.setPhase("crashed", reason);
        throw new EngineStartError(reason, this.ring.tail(30));
      }
      onWaiting?.(elapsed);
      await Promise.race([exitPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
    }
    this.record(
      `[app] ready on port ${launch.port} after ${Math.round((Date.now() - started) / 1000)} s\n`,
    );
    this.setPhase("running");
  }

  private onExit(
    child: ChildProcess,
    exited: { code: number | null; signal: NodeJS.Signals | null } | undefined,
    spawnError: Error | undefined,
  ): void {
    if (this.child !== child) return;
    this.child = undefined;
    // If the watchdog itself was killed, take its server down with it (same process group).
    if (child.pid && process.platform !== "win32") killWatchedNow(child.pid);
    this.record(
      `[app] engine exited (${spawnError ? spawnError.message : `code ${exited?.code ?? "?"}, signal ${exited?.signal ?? "none"}`})\n`,
    );
    if (this.stopping) {
      this.setPhase("stopped");
      return;
    }
    const reason = spawnError
      ? `The AI engine couldn't be started: ${spawnError.message}`
      : explainEngineFailure(this.ring.sinceLastStart(40), exited ?? { code: null, signal: null });
    const wasRunning = this.phase === "running";
    if (wasRunning && this.restartsLeft > 0) {
      this.restartsLeft -= 1;
      this.record("[app] the engine stopped unexpectedly; restarting it once\n");
      void this.spawnAndWait().catch((error: unknown) => {
        this.setPhase("crashed", error instanceof EngineStartError ? error.message : String(error));
      });
      return;
    }
    this.setPhase("crashed", reason);
  }

  private killChild(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    if (process.platform === "win32") {
      // taskkill /T also ends anything the server started; child.kill() is the fallback.
      execFile(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        (error) => {
          if (error && child.exitCode === null) child.kill();
        },
      );
      return;
    }
    // The watchdog passes TERM on to the server; KILL takes down its whole process group.
    child.kill("SIGTERM");
    const pid = child.pid;
    const hard = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) killWatchedNow(pid);
    }, 3_000);
    hard.unref();
  }

  /** Stops the server and waits (at most a few seconds) for it to exit. */
  async stop(timeoutMs = 5_000): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      child.once("exit", () => resolve());
    });
    this.killChild(child);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      killWatchedNow(child.pid);
    }
    if (this.child === child) this.child = undefined;
    this.log?.end();
    this.log = undefined;
  }

  /** For quitting: sends the stop signal without waiting. */
  stopNow(): void {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.killChild(child);
  }
}
