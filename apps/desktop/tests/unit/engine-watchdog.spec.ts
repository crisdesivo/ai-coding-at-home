import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import { APP_PID_ENV, POSIX_WATCHDOG_SCRIPT, killWatchedNow } from "../../electron/engine/watchdog";

test.skip(process.platform === "win32", "the POSIX watchdog");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A stand-in "app" process and a "server" (a long sleep) under the watchdog script. */
function startWatched() {
  const app = spawn("sleep", ["60"], { stdio: "ignore" });
  const watchdog = spawn(
    "/bin/sh",
    [
      "-c",
      `${POSIX_WATCHDOG_SCRIPT}`,
      "watchdog",
      "/bin/sh",
      "-c",
      "echo server $$; exec sleep 60",
    ],
    {
      env: { ...process.env, [APP_PID_ENV]: String(app.pid) },
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    },
  );
  const serverPid = new Promise<number>((resolve) => {
    watchdog.stdout.on("data", (chunk: Buffer) => {
      const match = /server (\d+)/.exec(chunk.toString());
      if (match) resolve(Number(match[1]));
    });
  });
  const exited = new Promise<number | null>((resolve) =>
    watchdog.once("exit", (code) => resolve(code)),
  );
  return { app, watchdog, serverPid, exited };
}

test("the server is stopped when the app is killed hard", async () => {
  const { app, watchdog, serverPid, exited } = startWatched();
  const server = await serverPid;
  expect(alive(server)).toBe(true);
  app.kill("SIGKILL");
  await exited;
  await expect.poll(() => alive(server), { timeout: 5_000 }).toBe(false);
  expect(watchdog.exitCode !== null || watchdog.signalCode !== null).toBe(true);
});

test("TERM to the watchdog reaches the server, and a hard stop takes the whole group", async () => {
  const first = startWatched();
  const server = await first.serverPid;
  first.watchdog.kill("SIGTERM");
  await first.exited;
  await expect.poll(() => alive(server), { timeout: 5_000 }).toBe(false);
  first.app.kill("SIGKILL");

  const second = startWatched();
  const server2 = await second.serverPid;
  if (second.watchdog.pid) killWatchedNow(second.watchdog.pid);
  await second.exited;
  await expect.poll(() => alive(server2), { timeout: 5_000 }).toBe(false);
  second.app.kill("SIGKILL");
});
