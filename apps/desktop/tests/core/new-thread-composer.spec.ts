import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  pasteTinyPng,
  seedAgentDir,
  TEST_LOCAL_MODEL_ID,
  TEST_LOCAL_PROVIDER_ID,
} from "../helpers/electron-app";

test("new thread reuses composer behaviors for slash commands, image previews, and branding", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-composer-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    await expect(window.getByTestId("new-thread-logo")).toBeVisible();
    await expect(window.getByRole("heading", { name: "Let's build" })).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveAttribute(
      "placeholder",
      "Ask pi anything, use / for commands and skills",
    );

    // One local model, named rather than picked.
    await expect(window.locator(".new-thread__hint").getByTestId("local-model-label")).toHaveText(
      "Test Model",
    );
    await expect(window.locator(".new-thread__hint .model-selector__dropdown")).toHaveCount(0);
    await expect(window.locator('.new-thread input[type="file"]')).toBeHidden();

    await composer.fill("/stat");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("/status");

    await composer.fill("Outline next steps /stat");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Status");
    await composer.press("Tab");
    await expect(slashMenu).toHaveCount(0);
    await expect(composer).toHaveValue("Outline next steps /status");

    await composer.fill("");
    await pasteTinyPng(window, "new-thread-image.png", "new-thread-composer");
    const chip = window.locator(".composer-attachment");
    await expect(chip).toBeVisible();
    await expect(chip.locator(".composer-attachment__preview")).toHaveAttribute(
      "title",
      "new-thread-image.png",
    );
    await expect(chip.locator(".composer-attachment__name")).toHaveCount(0);

    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const transcript = await getSelectedTranscript(window);
          const userMessage = transcript?.transcript.find(
            (entry): entry is Extract<typeof entry, { kind: "message" }> =>
              entry.kind === "message" && entry.role === "user",
          );
          return userMessage?.attachments?.map((attachment) => attachment.kind).join(",") ?? "";
        },
        { timeout: 15_000 },
      )
      .toBe("image");
    const sentImage = window.getByRole("button", { name: "View new-thread-image.png" });
    await expect(sentImage).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".composer-attachment")).toHaveCount(0);
    await sentImage.click();
    await expect(window.getByTestId("image-viewer")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("image-viewer")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test("every new thread starts on the local model with no picker or onboarding notice", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-local-model-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    scrubProviderEnv: true,
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    await window.getByTestId("new-thread-composer").fill("start on the local model");
    await expect(window.getByTestId("model-onboarding-notice")).toHaveCount(0);
    const startButton = window.getByRole("button", { name: "Start thread" });
    await expect(startButton).toBeEnabled();

    const runtime = (await getDesktopState(window)).runtimeByWorkspace;
    const models = Object.values(runtime).flatMap((snapshot) =>
      snapshot.models.map((model) => `${model.providerId}/${model.modelId}`),
    );
    expect([...new Set(models)]).toEqual([`${TEST_LOCAL_PROVIDER_ID}/${TEST_LOCAL_MODEL_ID}`]);

    await startButton.click();
    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".composer").getByTestId("local-model-label")).toHaveText(
      "Test Model",
    );
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const session = state.workspaces
          .flatMap((workspace) => workspace.sessions)
          .find((entry) => entry.id === state.selectedSessionId);
        return session?.config ? `${session.config.provider}/${session.config.modelId}` : "";
      })
      .toBe(`${TEST_LOCAL_PROVIDER_ID}/${TEST_LOCAL_MODEL_ID}`);
  } finally {
    await harness.close();
  }
});

test("new thread starts once when Enter is pressed twice before it opens", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("new-thread-double-submit-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const sessionCount = async () =>
      (await getDesktopState(window)).workspaces.reduce(
        (count, workspace) => count + workspace.sessions.length,
        0,
      );
    const before = await sessionCount();
    await openNewThread(window);

    const composer = window.getByTestId("new-thread-composer");
    await composer.fill("start exactly one thread");
    // Both key presses land before the first start returns, as a fast double Enter does.
    await composer.evaluate((element) => {
      for (let press = 0; press < 2; press += 1) {
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      }
    });

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
    await expect.poll(sessionCount, { timeout: 5_000 }).toBe(before + 1);
    // Give a late second start time to land before asserting it never did.
    await window.waitForTimeout(1_000);
    expect(await sessionCount()).toBe(before + 1);
  } finally {
    await harness.close();
  }
});
