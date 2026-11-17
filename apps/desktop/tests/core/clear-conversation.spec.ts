import { expect, test, type Page } from "@playwright/test";
import type { WorkspaceSessionTarget } from "../../contracts/desktop-state";
import {
  createNamedThread,
  desktopShortcut,
  expectNewThreadWorkspace,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import { startHangingOpenAiServer } from "../helpers/hanging-openai-server";
import { startScriptedOpenAiServer } from "../helpers/scripted-openai-server";

const REPLY = "Hello from the local model.";

async function selectedTarget(window: Page): Promise<WorkspaceSessionTarget> {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) {
    throw new Error("Expected a selected thread");
  }
  return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
}

async function sessionState(window: Page, target: WorkspaceSessionTarget) {
  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((candidate) => candidate.id === target.workspaceId);
  return {
    activeView: state.activeView,
    selected:
      state.selectedWorkspaceId === target.workspaceId &&
      state.selectedSessionId === target.sessionId,
    archived: Boolean(
      workspace?.sessions.find((session) => session.id === target.sessionId)?.archivedAt,
    ),
    status: workspace?.sessions.find((session) => session.id === target.sessionId)?.status,
    sessionCount: workspace?.sessions.length ?? 0,
  };
}

test("/clear starts fresh in the same folder, archives the thread, and Undo brings it back", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("clear-conversation-workspace");
  const server = await startScriptedOpenAiServer(() => ({ text: REPLY }));
  const harness = await launchDesktop(userDataDir, {
    localModel: { baseUrl: server.baseUrl },
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Chat to clear");
    const thread = await selectedTarget(window);
    const composer = window.getByTestId("composer");
    const transcript = window.getByTestId("transcript");
    const notice = window.getByTestId("clear-conversation-notice");

    await test.step("send a message and get the reply", async () => {
      await composer.fill("Say hello");
      await composer.press("Enter");
      await expect(transcript).toContainText(REPLY);
      await expect.poll(() => sessionState(window, thread)).toMatchObject({ status: "idle" });
    });

    await test.step("/clear opens a fresh conversation on the same folder", async () => {
      await composer.fill("/clear");
      const slashMenu = window.getByTestId("slash-menu");
      await expect(slashMenu).toContainText("Start a fresh conversation in this folder");
      await composer.press("Enter");

      await expectNewThreadWorkspace(window, workspacePath);
      await expect(window.getByTestId("new-thread-composer")).toBeFocused();
      await expect(window.getByTestId("new-thread-composer")).toHaveValue("");
      await expect(notice).toContainText("Conversation cleared");
      await expect
        .poll(() => sessionState(window, thread))
        // Archived, and no empty thread was made for the fresh conversation.
        .toMatchObject({ activeView: "new-thread", archived: true, sessionCount: 1 });
      await expect(
        window.locator(".session-list > .session-row").filter({ hasText: "Chat to clear" }),
      ).toHaveCount(0);
      await expect(window.locator(".archived-thread-group")).toContainText("Archived");
    });

    await test.step("Undo restores the thread and switches back to it", async () => {
      await notice.getByRole("button", { name: "Undo" }).click();
      await expect(notice).toHaveCount(0);
      await expect
        .poll(() => sessionState(window, thread))
        .toMatchObject({ activeView: "threads", selected: true, archived: false });
      await expect(transcript).toContainText(REPLY);
      await expect(composer).toBeFocused();
      // The typed `/clear` does not come back as a draft.
      await expect(composer).toHaveValue("");
    });

    await test.step("the header menu and the shortcut clear it too", async () => {
      await window.getByTestId("thread-header-menu").click();
      await window.locator('[data-thread-action="clear-conversation"]').click();
      await expectNewThreadWorkspace(window, workspacePath);
      await expect.poll(() => sessionState(window, thread)).toMatchObject({ archived: true });
      await notice.getByRole("button", { name: "Undo" }).click();
      await expect
        .poll(() => sessionState(window, thread))
        .toMatchObject({ activeView: "threads", selected: true, archived: false });

      await expect(composer).toBeFocused();
      await window.keyboard.press(desktopShortcut("Shift+K"));
      await expectNewThreadWorkspace(window, workspacePath);
      await expect.poll(() => sessionState(window, thread)).toMatchObject({ archived: true });
      await expect(notice).toBeVisible();
    });
  } finally {
    await harness.close();
    await server.close();
  }
});

test("Clear conversation waits for the reply to finish", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("clear-conversation-running-workspace");
  const server = await startHangingOpenAiServer();
  const harness = await launchDesktop(userDataDir, {
    localModel: { baseUrl: server.baseUrl },
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Busy thread");
    const thread = await selectedTarget(window);
    const composer = window.getByTestId("composer");
    await composer.fill("Take your time");
    await composer.press("Enter");
    await expect.poll(() => server.pendingRequestCount()).toBeGreaterThan(0);

    await window.getByTestId("thread-header-menu").click();
    const clear = window.locator('[data-thread-action="clear-conversation"]');
    await expect(clear).toHaveAttribute("aria-disabled", "true");
    await expect(clear).toHaveAttribute("title", "Wait for the reply to finish");
    // Playwright will not click an aria-disabled item unless forced; a user's click does nothing.
    await clear.click({ force: true });
    await window.keyboard.press("Escape");

    await composer.focus();
    await window.keyboard.press(desktopShortcut("Shift+K"));
    await composer.fill("/clear");
    await composer.press("Enter");
    // The typed command is refused and kept, rather than sent to the agent as a follow-up.
    await expect(window.getByTestId("composer-error-banner")).toContainText(
      "Wait for the reply to finish before clearing the conversation.",
    );
    await expect(composer).toHaveValue("/clear");

    await expect(window.getByTestId("clear-conversation-notice")).toHaveCount(0);
    await expect
      .poll(() => sessionState(window, thread))
      .toMatchObject({ activeView: "threads", selected: true, archived: false });
  } finally {
    await harness.close();
    await server.close();
  }
});
