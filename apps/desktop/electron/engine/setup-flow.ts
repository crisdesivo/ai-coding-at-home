import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  SetupAction,
  SetupError,
  SetupStep,
  SetupStepId,
  SetupView,
} from "../../contracts/engine";
import { MODEL_CATALOG, fileUrl, formatBytes } from "./catalog";
import {
  chooseModel,
  diskBytesNeeded,
  downloadKey,
  neededGb,
  type ChooseResult,
  type ModelChoice,
} from "./choose";
import {
  computerSpecs,
  describeComputer,
  detectComputer,
  unsupportedReason,
  type DetectedComputer,
} from "./detect";
import { DownloadError, downloadFile, freeDiskBytes, partialBytes } from "./download";
import { findFreePort, EngineStartError } from "./server";
import type { EngineManager, InstalledModel } from "./manager";

/** `PI_AT_HOME_TEST_MODEL=<local gguf path or URL>` replaces the chosen model's download (testing). */
export const TEST_MODEL_ENV = "PI_AT_HOME_TEST_MODEL";
export const TEST_MODEL_SHA256_ENV = "PI_AT_HOME_TEST_MODEL_SHA256";
/** With a test model: pretend this many bytes are free on the disk (testing the disk-space card). */
export const TEST_DISK_FREE_ENV = "PI_AT_HOME_TEST_DISK_FREE";

export interface SetupUi {
  show(view: SetupView): void;
  /** The next button the person presses; closing the window counts as "quit" (or "close"). */
  nextAction(): Promise<SetupAction["id"]>;
}

export type SetupOutcome = "ready" | "quit" | "closed" | "restart-app";

const STEP_LABELS: Record<SetupStepId, string> = {
  check: "Checking your computer",
  choose: "Choosing the AI model",
  download: "Downloading the AI model",
  start: "Starting the AI",
};

const RETRY: SetupAction = { id: "retry", label: "Retry", primary: true };
const QUIT: SetupAction = { id: "quit", label: "Quit" };

class StepError extends Error {
  constructor(
    readonly step: SetupStepId,
    readonly card: SetupError,
    readonly actions: readonly SetupAction[] = [RETRY, QUIT],
  ) {
    super(card.reason);
  }
}

/** One file to download: a model part (or the test model). */
export interface DownloadItem {
  readonly url: string;
  /** File name in the models folder. */
  readonly name: string;
  readonly bytes: number;
  readonly sha256?: string;
}

/** The model and quant chosen, as files to download. */
export interface PlannedModel {
  readonly id: string;
  readonly name: string;
  readonly quant: string;
  readonly reasoning: boolean;
  readonly maxTokens: number;
  readonly neededGb: number;
  readonly items: readonly DownloadItem[];
  readonly sizeBytes: number;
  /** Downloading from a test source instead of Hugging Face. */
  readonly testSource?: string;
}

export function planFor(choice: ModelChoice): PlannedModel {
  const items = choice.files.map((file) => ({
    url: fileUrl(file),
    name: path.basename(file.file),
    bytes: file.bytes,
    sha256: file.sha256,
  }));
  return {
    id: choice.model.id,
    name: choice.model.name,
    quant: choice.quant,
    reasoning: choice.model.reasoning,
    maxTokens: choice.model.maxTokens,
    neededGb: choice.neededGb,
    items,
    sizeBytes: choice.sizeBytes,
  };
}

/**
 * Testing: `PI_AT_HOME_TEST_MODEL` (a local path or URL) replaces the download. When its file name
 * is a catalog file, that model and quant (and sha256) are used; otherwise the chosen model's
 * settings with the file's own size and `PI_AT_HOME_TEST_MODEL_SHA256` (if set).
 */
async function testModelOverride(
  env: NodeJS.ProcessEnv,
  chosen: PlannedModel,
): Promise<PlannedModel> {
  const source = env[TEST_MODEL_ENV]?.trim();
  if (!source) return chosen;
  const name = path.basename(source.split("?")[0] ?? source);
  let known:
    | { model: (typeof MODEL_CATALOG)[number]; quant: string; sha256: string; bytes: number }
    | undefined;
  for (const model of MODEL_CATALOG) {
    for (const [quant, parts] of Object.entries(model.quants)) {
      const only = parts.length === 1 ? parts[0] : undefined;
      if (only && path.basename(only.file) === name) {
        known = { model, quant, sha256: only.sha256, bytes: only.bytes };
      }
    }
  }
  let bytes = known?.bytes;
  if (!/^https?:\/\//i.test(source)) {
    const { stat } = await import("node:fs/promises");
    bytes = (await stat(source)).size;
  } else if (bytes === undefined) {
    const head = await fetch(source, { method: "HEAD" }).catch(() => undefined);
    const length = Number(head?.headers.get("content-length") ?? NaN);
    bytes = Number.isFinite(length) ? length : 0;
  }
  const sha256 = env[TEST_MODEL_SHA256_ENV]?.trim() || known?.sha256;
  const item: DownloadItem = {
    url: source,
    name,
    bytes: bytes ?? 0,
    ...(sha256 ? { sha256 } : {}),
  };
  return {
    ...chosen,
    ...(known
      ? {
          id: known.model.id,
          name: known.model.name,
          quant: known.quant,
          reasoning: known.model.reasoning,
          maxTokens: known.model.maxTokens,
          neededGb: neededGb(known.model, known.quant) ?? chosen.neededGb,
        }
      : {}),
    items: [item],
    sizeBytes: item.bytes,
    testSource: source,
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * The Setup screen's logic: check the computer, choose and download the model, start the engine.
 * Every failure becomes a card with the reason and a Retry button; nothing waits silently.
 */
export class SetupFlow {
  private steps: SetupStep[];
  private view: SetupView;
  private computer: DetectedComputer | undefined;

  constructor(
    private readonly manager: EngineManager,
    private readonly ui: SetupUi,
    private readonly options: {
      readonly mode: "first-run" | "recheck";
      readonly env: NodeJS.ProcessEnv;
      /** Writes local-model.json once the port is known (first run). */
      readonly configPath: string;
      /** Aborted when the window closes, so a download does not go on unseen. */
      readonly signal?: AbortSignal;
    },
  ) {
    this.steps = (Object.keys(STEP_LABELS) as SetupStepId[])
      .filter((id) => options.mode === "first-run" || id !== "start")
      .map((id) => ({ id, label: STEP_LABELS[id], status: "pending" }));
    this.view = {
      mode: options.mode,
      headline:
        options.mode === "first-run" ? "Setting up AI Coding at Home" : "Checking your computer",
      steps: this.steps,
      actions: [],
    };
  }

  current(): SetupView {
    return this.view;
  }

  private update(patch: Partial<SetupView>): void {
    this.view = { ...this.view, steps: this.steps, ...patch };
    this.ui.show(this.view);
  }

  private setStep(id: SetupStepId, status: SetupStep["status"]): void {
    this.steps = this.steps.map((step) => (step.id === id ? { ...step, status } : step));
  }

  async run(): Promise<SetupOutcome> {
    for (;;) {
      try {
        return await this.attempt();
      } catch (error) {
        const failure =
          error instanceof StepError
            ? error
            : new StepError(this.activeStep() ?? "check", {
                title: "Something went wrong",
                reason: error instanceof Error ? error.message : String(error),
              });
        this.setStep(failure.step, "error");
        this.update({
          headline: failure.card.title,
          subline: undefined,
          progress: undefined,
          error: failure.card,
          actions: failure.actions,
        });
        const action = await this.ui.nextAction();
        if (action === "quit") return "quit";
        if (action === "close") return "closed";
        this.steps = this.steps.map((step) => ({ ...step, status: "pending" }));
        this.update({ error: undefined, actions: [] });
      }
    }
  }

  private activeStep(): SetupStepId | undefined {
    return this.steps.find((step) => step.status === "active")?.id;
  }

  private async attempt(): Promise<SetupOutcome> {
    const closeOrQuit: SetupAction =
      this.options.mode === "first-run" ? QUIT : { id: "close", label: "Close" };

    // 1. Check the computer.
    this.setStep("check", "active");
    this.update({
      headline: "Checking your computer…",
      subline: "Looking at the graphics card, memory and free disk space.",
      progress: undefined,
      computer: undefined,
      model: undefined,
    });
    const unsupported = unsupportedReason(process.platform, process.arch);
    if (unsupported) {
      throw new StepError(
        "check",
        { title: "This computer isn't supported", reason: unsupported },
        [closeOrQuit],
      );
    }
    const serverPath = this.manager.bundledServerPath();
    if (!serverPath) {
      throw new StepError("check", {
        title: "The AI engine is missing",
        reason:
          "This copy of AI Coding at Home is missing its AI engine. Please download and install the app again.",
      });
    }
    try {
      this.computer = await detectComputer(serverPath);
    } catch (error) {
      const output = (error as { output?: string }).output ?? "";
      throw new StepError("check", {
        title: "Couldn't check this computer",
        reason: error instanceof Error ? error.message : String(error),
        details: output.split(/\r?\n/).filter(Boolean).slice(-12),
      });
    }
    const computer = this.computer;
    await this.manager.save({
      hasNvidia: computer.hasNvidia,
      bundledBackend: computer.platform === "darwin" ? "metal" : computer.gpu ? "vulkan" : "cpu",
    });
    this.setStep("check", "done");

    // 2. Choose the model.
    this.setStep("choose", "active");
    this.update({
      headline: "Choosing the AI model…",
      subline: undefined,
      computer: describeComputer(computer),
    });
    await mkdir(this.manager.modelsDir, { recursive: true });
    const { result, freeBytes } = await this.choose(computer);
    if (result.kind === "too-small") {
      const ramGb = Math.round(computer.ramBytes / 1024 ** 3);
      throw new StepError(
        "choose",
        {
          title: "This computer is too small for AI coding",
          reason: `Even the smallest model (${result.smallest.model.name}) needs about ${result.smallest.neededGb.toFixed(1)} GB of memory with a long conversation. This computer has ${ramGb} GB of memory${computer.gpu ? ` and a graphics card with ${Math.round(computer.gpu.totalMiB / 1024)} GB` : " and no graphics card the AI can use"}.`,
        },
        [RETRY, closeOrQuit],
      );
    }
    if (result.kind === "no-disk") {
      throw new StepError(
        "choose",
        {
          title: "Not enough free disk space",
          reason: `The AI model needs ${formatBytes(result.neededBytes)} free (including 2 GB to spare), but only ${formatBytes(result.freeBytes)} is free on the drive with ${this.manager.modelsDir}. Free up some space, then press Retry.`,
        },
        [RETRY, closeOrQuit],
      );
    }
    const model = await testModelOverride(this.options.env, planFor(result.choice));
    const notes = this.notesFor(result, freeBytes, model);
    const already = await this.downloadedBytes(model.items);
    if (already > 0 && already < model.sizeBytes) {
      notes.push(
        `Continuing an earlier download (${formatBytes(already)} of ${formatBytes(model.sizeBytes)} already here).`,
      );
    }
    this.update({
      model: {
        name: model.name,
        size: formatBytes(model.sizeBytes),
        notes,
        details: `Technical details: ${model.name} · quality setting ${model.quant} · needs about ${model.neededGb.toFixed(1)} GB of memory for a 100k-token conversation.`,
      },
    });
    this.setStep("choose", "done");

    // Re-check: nothing to do when the same model is already here.
    const installed = this.manager.current.model;
    if (this.options.mode === "recheck") {
      if (
        installed &&
        installed.id === model.id &&
        installed.quant === model.quant &&
        (await this.manager.hasInstalledModel())
      ) {
        this.setStep("download", "done");
        this.update({
          headline: "You already have the best model for this computer",
          subline: `${installed.name} stays in use.`,
          done: true,
          actions: [{ id: "close", label: "Close", primary: true }],
        });
        await this.ui.nextAction();
        return "closed";
      }
      const sameModel = installed?.id === model.id;
      this.update({
        headline: !installed
          ? `This computer can use ${model.name}`
          : sameModel
            ? `A better version of ${model.name} fits this computer`
            : `${model.name} is a better fit for this computer`,
        subline:
          `It's a ${formatBytes(model.sizeBytes)} download. ${installed ? `The current ${installed.name} keeps working until you restart the app.` : ""}`.trim(),
        actions: [
          {
            id: "switch",
            label: sameModel ? "Download it" : `Download ${model.name}`,
            primary: true,
          },
          {
            id: "close",
            label: !installed
              ? "Not now"
              : sameModel
                ? "Keep the current one"
                : `Keep ${installed.name}`,
          },
        ],
      });
      const choice = await this.ui.nextAction();
      if (choice !== "switch") return "closed";
      this.update({ actions: [] });
    }

    // 3. Download.
    this.setStep("download", "active");
    const files = model.items.map((item) => ({
      path: this.manager.modelPathFor(item.name),
      sizeBytes: item.bytes,
      ...(item.sha256 ? { sha256: item.sha256 } : {}),
    }));
    const firstFile = files[0];
    if (!firstFile) throw new Error(`${model.name} has no files to download.`);
    const sameAsInstalled =
      installed?.path === firstFile.path && (await this.manager.hasInstalledModel());
    if (!sameAsInstalled) {
      await this.download(model);
    }
    const installedModel: InstalledModel = {
      id: model.id,
      name: model.name,
      quant: model.quant,
      // llama.cpp loads the other parts of a split GGUF from the first one.
      path: firstFile.path,
      files,
      sizeBytes: model.sizeBytes,
      reasoning: model.reasoning,
      maxTokens: model.maxTokens,
    };
    this.setStep("download", "done");

    if (this.options.mode === "recheck") {
      await this.manager.save({ model: installedModel });
      await this.manager.resetCuda();
      this.update({
        headline: `${model.name} is ready`,
        subline: "Restart the app to start using it.",
        progress: undefined,
        done: true,
        actions: [
          { id: "restart-app", label: "Restart now", primary: true },
          { id: "close", label: "Later" },
        ],
      });
      const choice = await this.ui.nextAction();
      return choice === "restart-app" ? "restart-app" : "closed";
    }

    // 4. Start the engine.
    this.setStep("start", "active");
    this.update({
      headline: "Starting the AI…",
      subline: "Loading the model into memory.",
      progress: undefined,
    });
    await this.manager.save({ model: installedModel });
    const port = await findFreePort(this.manager.current.port);
    await this.manager.save({ port });
    await this.manager.writeLocalModelConfig(
      this.options.configPath,
      this.manager.localModelConfig(port, installedModel),
    );
    try {
      await this.manager.startServer(installedModel, port, (elapsed) => {
        this.update({
          subline: `Loading the model into memory… ${formatDuration(elapsed)}${elapsed > 120_000 ? " (big models can take a few minutes the first time)" : ""}`,
        });
      });
    } catch (error) {
      throw new StepError(
        "start",
        {
          title: "The AI didn't start",
          reason: error instanceof Error ? error.message : String(error),
          details: error instanceof EngineStartError ? error.logTail.slice(-12) : undefined,
        },
        [RETRY, { id: "open-log", label: "Show engine log" }, QUIT],
      );
    }
    this.setStep("start", "done");
    this.update({
      headline: "Ready",
      subline: "Opening AI Coding at Home…",
      done: true,
      actions: [],
    });
    return "ready";
  }

  /** Free space on the models drive; tests can pretend the disk is fuller. */
  private async freeBytes(): Promise<number | undefined> {
    const pretend = Number(this.options.env[TEST_DISK_FREE_ENV]);
    if (this.options.env[TEST_MODEL_ENV] && Number.isFinite(pretend) && pretend >= 0) {
      return pretend;
    }
    return freeDiskBytes(this.manager.modelsDir).catch(() => undefined);
  }

  /** Bytes of these files already on disk: finished files and unfinished `.part` files. */
  private async downloadedBytes(
    items: readonly Pick<DownloadItem, "name" | "bytes">[],
  ): Promise<number> {
    let total = 0;
    for (const item of items) {
      const destination = this.manager.modelPathFor(item.name);
      const done = await stat(destination).catch(() => undefined);
      total += done && done.size === item.bytes ? done.size : await partialBytes(destination);
    }
    return total;
  }

  private async choose(
    computer: DetectedComputer,
  ): Promise<{ readonly result: ChooseResult; readonly freeBytes: number | undefined }> {
    const freeBytes = await this.freeBytes();
    const downloaded: Record<string, number> = {};
    for (const entry of MODEL_CATALOG) {
      for (const [quant, parts] of Object.entries(entry.quants)) {
        const bytes = await this.downloadedBytes(
          parts.map((part) => ({ name: path.basename(part.file), bytes: part.bytes })),
        );
        if (bytes > 0) downloaded[downloadKey(entry.id, quant)] = bytes;
      }
    }
    const installed = this.manager.current.model;
    const result = chooseModel({
      computer: computerSpecs(computer),
      ...(freeBytes !== undefined ? { diskFreeBytes: freeBytes } : {}),
      downloadedBytes: downloaded,
      ...(installed?.quant && (await this.manager.hasInstalledModel())
        ? { installed: { modelId: installed.id, quant: installed.quant } }
        : {}),
    });
    return { result, freeBytes };
  }

  private notesFor(
    result: Extract<ChooseResult, { kind: "ok" }>,
    freeBytes: number | undefined,
    model: PlannedModel,
  ): string[] {
    const notes: string[] = [];
    if (result.limitedByDisk) {
      const better = result.hardwarePick;
      const sameModel = better.model.id === result.choice.model.id;
      notes.push(
        sameModel
          ? `Your computer could run ${better.model.name} at a higher quality setting (${formatBytes(better.sizeBytes)}), but only ${formatBytes(freeBytes ?? 0)} is free on your disk, so we're using a smaller version (${formatBytes(result.choice.sizeBytes)}). Free up space and press "Re-check my computer" in Settings to get the better one.`
          : `Your computer could run ${better.model.name} (${formatBytes(better.sizeBytes)}), but only ${formatBytes(freeBytes ?? 0)} is free on your disk, so we're using ${result.choice.model.name} (${formatBytes(result.choice.sizeBytes)}). Free up space and press "Re-check my computer" in Settings to get the bigger one.`,
      );
    }
    if (result.choice.partlyInSystemMemory) {
      notes.push(
        "Part of the model runs from your computer's memory, so replies are a bit slower.",
      );
    }
    if (result.basic) {
      notes.push(
        "This computer can only run the smallest model, so coding help will be basic: fine for small tasks, weaker on big ones.",
      );
    }
    if (model.testSource) {
      notes.push(`Testing: downloading from ${model.testSource}.`);
    }
    return notes;
  }

  private async download(model: PlannedModel): Promise<void> {
    // Free space is checked again right before starting or resuming.
    const free = await this.freeBytes();
    const needed = diskBytesNeeded(model.sizeBytes, await this.downloadedBytes(model.items), false);
    if (free !== undefined && free < needed) {
      throw new StepError("download", {
        title: "Not enough free disk space",
        reason: `${model.name} needs ${formatBytes(needed)} free (including 2 GB to spare), but only ${formatBytes(free)} is free on the drive with ${this.manager.modelsDir}. Free up some space, then press Retry; the download continues where it stopped.`,
      });
    }
    this.update({ headline: `Downloading ${model.name}…`, subline: undefined });
    const total = model.sizeBytes;
    let before = 0;
    for (const [index, item] of model.items.entries()) {
      const destination = this.manager.modelPathFor(item.name);
      const done = await stat(destination).catch(() => undefined);
      if (done && item.bytes > 0 && done.size === item.bytes) {
        before += item.bytes;
        continue;
      }
      const partLabel =
        model.items.length > 1 ? ` (part ${index + 1} of ${model.items.length})` : "";
      try {
        await downloadFile({
          url: item.url,
          destination,
          expectedSize: item.bytes > 0 ? item.bytes : undefined,
          ...(this.options.signal ? { signal: this.options.signal } : {}),
          ...(item.sha256 ? { sha256: item.sha256 } : {}),
          sourceLabel: /huggingface\.co/.test(item.url)
            ? "Hugging Face (huggingface.co)"
            : undefined,
          onProgress: (progress) => {
            const label =
              progress.phase === "checking-existing"
                ? "Checking what was already downloaded"
                : progress.phase === "verifying"
                  ? "Checking the download"
                  : "Downloading";
            const totalBytes = total > 0 ? total : progress.totalBytes;
            const received = before + progress.receivedBytes;
            this.update({
              subline:
                progress.stalledSeconds !== undefined
                  ? `No data received for ${formatDuration(progress.stalledSeconds * 1000)}. Check your internet connection; still trying…`
                  : undefined,
              progress: {
                label: `${label}${partLabel}`,
                receivedBytes: received,
                totalBytes,
                bytesPerSecond: progress.bytesPerSecond,
                ...(progress.bytesPerSecond > 0 && progress.stalledSeconds === undefined
                  ? { etaSeconds: Math.max(0, (totalBytes - received) / progress.bytesPerSecond) }
                  : {}),
                ...(progress.stalledSeconds !== undefined
                  ? { stalledSeconds: progress.stalledSeconds }
                  : {}),
              },
            });
          },
        });
      } catch (error) {
        const titles: Record<string, string> = {
          offline: "No internet connection",
          "disk-full": "Not enough free disk space",
          checksum: "The download was damaged",
          stalled: "The download stalled",
          http: "The download server had a problem",
          interrupted: "The download was interrupted",
          io: "Couldn't save the download",
          cancelled: "The download was cancelled",
        };
        if (error instanceof DownloadError) {
          throw new StepError("download", {
            title: titles[error.kind] ?? "The download failed",
            reason: error.message,
          });
        }
        throw error;
      }
      before += item.bytes;
    }
    this.update({ progress: undefined, subline: undefined });
  }
}
