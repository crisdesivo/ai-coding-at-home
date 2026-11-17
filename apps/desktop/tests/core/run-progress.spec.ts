import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import {
  startScriptedOpenAiServer,
  type ScriptedChatRequest,
  type ScriptedReply,
} from "../helpers/scripted-openai-server";

/** A long heredoc rewrite, the kind a small local model streams for minutes. */
const BOARD_COMMAND = [
  "cat > board.js <<'EOF'",
  ...Array.from({ length: 60 }, (_, index) => `const square${index} = ${index};`),
  "EOF",
].join("\n");

function lastMessage(request: ScriptedChatRequest) {
  return request.messages.at(-1);
}

function lastUserText(request: ScriptedChatRequest): string {
  return request.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
}

async function selectedStatus(window: Page): Promise<string | undefined> {
  const state = await getDesktopState(window);
  return state.workspaces
    .find((workspace) => workspace.id === state.selectedWorkspaceId)
    ?.sessions.find((session) => session.id === state.selectedSessionId)?.status;
}

async function send(window: Page, text: string): Promise<void> {
  const composer = window.getByTestId("composer");
  await composer.fill(text);
  await composer.press("Enter");
}

async function tokenCount(window: Page): Promise<number> {
  const stats = (await window.getByTestId("run-progress-stats").textContent()) ?? "";
  const match = /(\d+) tokens?/.exec(stats);
  return match ? Number(match[1]) : 0;
}

test("the working line shows what a slow local model writes, its tokens, and when it goes quiet", async () => {
  test.setTimeout(120_000);
  const reply = (request: ScriptedChatRequest): ScriptedReply => {
    // After the tool ran, the model answers in words.
    if (lastMessage(request)?.role === "tool") return { text: "Board rewritten." };
    if (lastUserText(request).includes("Rewrite")) {
      // About 4 tokens a second, like a small model on a laptop.
      return {
        tool: "bash",
        args: { command: BOARD_COMMAND },
        streamChunks: 40,
        chunkDelayMs: 150,
      };
    }
    // The model never answers: the run sits silent until the person stops it.
    return { text: "Too late.", delayMs: 60_000 };
  };
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("run-progress");
  const server = await startScriptedOpenAiServer(reply);
  const harness = await launchDesktop(userDataDir, {
    localModel: { baseUrl: server.baseUrl, contextWindow: 32_768 },
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    // The real threshold is 60 s; the test waits a moment instead.
    envOverrides: { PI_APP_QUIET_NOTICE_AFTER_MS: "2000" },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Checkers");
    const working = window.getByTestId("timeline-working");
    const activity = window.getByTestId("run-progress-activity");

    await test.step("a streaming heredoc names its file and counts tokens as they come", async () => {
      await send(window, "Rewrite the board");
      await expect(activity).toHaveText("Writing board.js…", { timeout: 30_000 });
      const stats = window.getByTestId("run-progress-stats");
      await expect(stats).toContainText(
        /\d+ tokens? · [\d.]+ tokens\/s · this step \d+s · Working for \d+s/,
      );
      const first = await tokenCount(window);
      await expect.poll(() => tokenCount(window), { timeout: 10_000 }).toBeGreaterThan(first);
      // Steady output is not "quiet", even past the shortened threshold.
      await window.waitForTimeout(2_500);
      await expect(window.getByTestId("run-progress-quiet")).toHaveCount(0);

      await expect(window.getByText("Board rewritten.")).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => selectedStatus(window), { timeout: 30_000 }).toBe("idle");
      await expect(working).toHaveCount(0);
    });

    await test.step("a model that produces nothing gets a plain notice and a Stop button", async () => {
      await send(window, "Are you there?");
      await expect(activity).toHaveText("Reading the conversation…", { timeout: 30_000 });
      const quiet = window.getByTestId("run-progress-quiet");
      await expect(quiet).toContainText("The local AI hasn't produced anything for 1 min", {
        timeout: 15_000,
      });
      await expect(window.getByRole("button", { name: "Stop run" })).toBeVisible();

      await quiet.getByTestId("run-progress-stop").click();
      await expect.poll(() => selectedStatus(window), { timeout: 30_000 }).toBe("idle");
      await expect(working).toHaveCount(0);
    });
  } finally {
    await harness.close();
    await server.close();
  }
});
