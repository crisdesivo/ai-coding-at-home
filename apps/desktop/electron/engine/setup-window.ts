import { BrowserWindow, shell, type WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setupIpc, type SetupAction, type SetupView } from "../../contracts/engine";
import { mainFrameHandler } from "../ipc/main-frame-ipc";
import type { EngineManager } from "./manager";
import { SetupFlow, type SetupOutcome } from "./setup-flow";

interface ActiveSetup {
  readonly window: BrowserWindow;
  readonly flow: SetupFlow;
  readonly onAction: (id: SetupAction["id"]) => void;
}

let active: ActiveSetup | undefined;
let handlersRegistered = false;

function registerHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  const handle = mainFrameHandler({
    windowForSender: (sender: WebContents) => {
      if (!active || active.window.isDestroyed() || active.window.webContents !== sender) {
        throw new Error("Setup requests only come from the Setup window.");
      }
      return active.window;
    },
  });
  handle(
    setupIpc.getView,
    () => undefined,
    () => active?.flow.current(),
  );
  handle(
    setupIpc.action,
    (raw) => {
      const ids: readonly SetupAction["id"][] = [
        "retry",
        "quit",
        "close",
        "switch",
        "restart-app",
        "open-log",
      ];
      if (typeof raw !== "string" || !ids.includes(raw as SetupAction["id"])) {
        throw new Error("Unknown setup action.");
      }
      return raw as SetupAction["id"];
    },
    (id) => {
      active?.onAction(id);
    },
  );
}

function setupUrl(): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    return new URL("setup.html", devUrl.endsWith("/") ? devUrl : `${devUrl}/`).toString();
  }
  return pathToFileURL(path.join(__dirname, "..", "renderer", "setup.html")).toString();
}

export interface SetupWindowResult {
  readonly outcome: SetupOutcome;
  /** Still open after "ready", so the app has a window until the main one shows; close it then. */
  readonly window: BrowserWindow | undefined;
}

/**
 * Shows the Setup window and runs the setup flow in it. First run: resolves "ready" once the
 * engine answers, or "quit" when the person quits or closes the window.
 */
export async function runSetupWindow(options: {
  readonly manager: EngineManager;
  readonly mode: "first-run" | "recheck";
  readonly env: NodeJS.ProcessEnv;
  readonly configPath: string;
  readonly icon?: Electron.NativeImage;
  readonly parent?: BrowserWindow;
  readonly backgroundColor?: string;
}): Promise<SetupWindowResult> {
  if (active && !active.window.isDestroyed()) {
    active.window.focus();
    return { outcome: "closed", window: undefined };
  }
  registerHandlers();
  const window = new BrowserWindow({
    width: 600,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    title:
      options.mode === "first-run"
        ? "AI Coding at Home – Setup"
        : "AI Coding at Home – Check computer",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: options.backgroundColor ?? "#f7f7f5",
    ...(options.icon ? { icon: options.icon } : {}),
    ...(options.parent ? { parent: options.parent } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "setup-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const waiters: Array<(id: SetupAction["id"]) => void> = [];
  const pending: SetupAction["id"][] = [];
  const deliver = (id: SetupAction["id"]) => {
    if (id === "open-log") {
      shell
        .openPath(options.manager.logPath)
        .then((error) => {
          if (error) console.error("[setup] opening the engine log failed:", error);
        })
        .catch((error: unknown) => console.error("[setup] opening the engine log failed", error));
      return;
    }
    const waiter = waiters.shift();
    if (waiter) waiter(id);
    else pending.push(id);
  };
  let closedByApp = false;
  const abort = new AbortController();
  const flow = new SetupFlow(
    options.manager,
    {
      show: (view: SetupView) => {
        if (!window.isDestroyed()) window.webContents.send(setupIpc.view, view);
      },
      nextAction: () =>
        new Promise((resolve) => {
          const next = pending.shift();
          if (next) resolve(next);
          else waiters.push(resolve);
        }),
    },
    { mode: options.mode, env: options.env, configPath: options.configPath, signal: abort.signal },
  );
  active = { window, flow, onAction: deliver };
  window.on("closed", () => {
    if (active?.window === window) active = undefined;
    abort.abort();
    if (!closedByApp) deliver(options.mode === "first-run" ? "quit" : "close");
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(setupUrl());

  // Closing the window mid-download stops waiting: the flow's next prompt resolves "quit"/"close".
  const outcome = await Promise.race([
    flow.run(),
    new Promise<SetupOutcome>((resolve) =>
      window.once("closed", () => resolve(options.mode === "first-run" ? "quit" : "closed")),
    ),
  ]);
  if (outcome === "ready" && !window.isDestroyed()) {
    return { outcome, window };
  }
  closedByApp = true;
  if (!window.isDestroyed()) window.close();
  return { outcome, window: undefined };
}
