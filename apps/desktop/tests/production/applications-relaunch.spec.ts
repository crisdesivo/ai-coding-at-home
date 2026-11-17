import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  copyAppBundle,
  createNamedThread,
  extractPackagedReleaseZipAppBundle,
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  resolveAppBundleExecutable,
  seedAgentDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("launches an installed app copy from /Applications and relaunches with persisted state", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir("pi-gui-installed-user-data-");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const workspacePath = await makeWorkspace("applications-relaunch-workspace");
  const threadTitle = "Applications relaunch smoke";
  const extractedAppBundle = await extractPackagedReleaseZipAppBundle();
  const installedAppBundle = join("/Applications", `pi-gui self-test ${Date.now()}.app`);
  await copyAppBundle(extractedAppBundle, installedAppBundle);

  const expectedExecutablePath = await resolveAppBundleExecutable(installedAppBundle);

  const firstRun = await launchDesktopByExecutable(expectedExecutablePath, userDataDir, {
    initialWorkspaces: [workspacePath],
    agentDir,
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await createNamedThread(window, threadTitle);
    await expect(window.locator(".chat-header__title")).toHaveText(threadTitle);
    await expect(window.getByTestId("composer")).toBeFocused();
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchDesktopByExecutable(expectedExecutablePath, userDataDir, {
    agentDir,
    testMode: "background",
    inheritParentEnv: false,
    envOverrides: {
      HOME: process.env.HOME,
      USER: process.env.USER,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
  });

  try {
    const window = await secondRun.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.locator(".chat-header__title")).toHaveText(threadTitle);
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await expect(window.getByTestId("composer")).toBeFocused();
  } finally {
    await secondRun.close();
    await rm(installedAppBundle, { recursive: true, force: true });
  }
});
