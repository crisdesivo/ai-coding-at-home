import { spawn, type ChildProcess } from "node:child_process";

/**
 * The engine must never outlive the app, even when the app is killed hard (SIGKILL, a crash) and
 * its quit handlers never run. llama-server doesn't watch its parent, so it runs under a watchdog:
 *
 * - POSIX: a tiny `sh` script starts llama-server in the background, forwards TERM/INT/HUP to it,
 *   and once a second checks that the app's process still exists; when it doesn't, it stops the
 *   server (TERM, then KILL after 3 s). The script runs in its own process group, so a hard stop
 *   from the app kills the group (script and server) at once.
 * - Windows: llama-server is started directly and a hidden PowerShell loop stops it when the app's
 *   process is gone (checking the process name, so a reused id is never killed).
 */
export const APP_PID_ENV = "PI_AT_HOME_APP_PID";

export const POSIX_WATCHDOG_SCRIPT = [
  '"$@" &',
  "S=$!",
  `trap 'kill -TERM "$S" 2>/dev/null' TERM INT HUP`,
  'while kill -0 "$S" 2>/dev/null; do',
  `  if ! kill -0 "$${APP_PID_ENV}" 2>/dev/null; then`,
  '    kill -TERM "$S" 2>/dev/null',
  "    n=0",
  '    while kill -0 "$S" 2>/dev/null && [ "$n" -lt 30 ]; do sleep 0.1; n=$((n+1)); done',
  '    kill -KILL "$S" 2>/dev/null',
  "    break",
  "  fi",
  "  sleep 1",
  "done",
  'wait "$S"',
].join("\n");

export function windowsWatchdogScript(appPid: number, serverPid: number): string {
  return [
    `$app = ${appPid}; $server = ${serverPid}`,
    "while ($true) {",
    "  $s = Get-Process -Id $server -ErrorAction SilentlyContinue",
    "  if (-not $s -or $s.ProcessName -ne 'llama-server') { exit }",
    "  if (-not (Get-Process -Id $app -ErrorAction SilentlyContinue)) { Stop-Process -Id $server -Force; exit }",
    "  Start-Sleep -Seconds 2",
    "}",
  ].join("\n");
}

/** Starts llama-server under the watchdog; stdout/stderr are the server's. */
export function spawnWatched(
  serverPath: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  platform: NodeJS.Platform = process.platform,
): ChildProcess {
  const env = { ...options.env, [APP_PID_ENV]: String(process.pid) };
  if (platform === "win32") {
    const child = spawn(serverPath, [...args], {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (child.pid) {
      const watchdog = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          windowsWatchdogScript(process.pid, child.pid),
        ],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      watchdog.on("error", (error) => console.error("[engine] watchdog failed to start", error));
      watchdog.unref();
    }
    return child;
  }
  return spawn(
    "/bin/sh",
    ["-c", POSIX_WATCHDOG_SCRIPT, "llama-server-watchdog", serverPath, ...args],
    {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group: a hard stop kills the watchdog and the server together.
      detached: true,
    },
  );
}

/** Kills the watched server at once: its whole process group on POSIX (gone already is fine). */
export function killWatchedNow(pid: number, platform: NodeJS.Platform = process.platform): void {
  try {
    process.kill(platform === "win32" ? pid : -pid, "SIGKILL");
  } catch {
    // already gone
  }
}
