import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  expectNewThreadWorkspace,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import {
  isSummaryRequest,
  startScriptedOpenAiServer,
  type ScriptedChatRequest,
  type ScriptedReply,
} from "../helpers/scripted-openai-server";

/** What a full 16k llama.cpp context returns: "length" after one token, and no text. */
const OUT_OF_ROOM: ScriptedReply = {
  text: "",
  finishReason: "length",
  usage: { prompt: 12_500, completion: 1 },
};

/** A reply long enough (~1,750 tokens) that two of them give pi something to summarize. */
const LONG_REPLY = `${"The answer goes on in detail. ".repeat(230)}End of answer.`;

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

async function launch(
  name: string,
  reply: (request: ScriptedChatRequest) => ScriptedReply,
  contextWindow: number,
) {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace(name);
  const server = await startScriptedOpenAiServer(reply);
  const harness = await launchDesktop(userDataDir, {
    localModel: { baseUrl: server.baseUrl, contextWindow },
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
  return { workspacePath, server, harness };
}

test("a reply cut off with nothing to summarize shows an out-of-room card, and its actions work", async () => {
  test.setTimeout(120_000);
  const { workspacePath, server, harness } = await launch(
    "run-failure-out-of-room",
    () => OUT_OF_ROOM,
    16_384,
  );
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "No room");
    const card = window.getByTestId("run-failure-card");

    await test.step("the turn ends with an out-of-room card instead of silence", async () => {
      await send(window, "Hello?");
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toHaveAttribute("data-failure-kind", "out-of-room");
      await expect(card).toContainText(
        "The local AI ran out of room in this conversation before it could answer.",
      );
      await expect(card.getByTestId("run-failure-summarize")).toHaveText("Summarize and try again");
      await expect(card.getByTestId("run-failure-startFresh")).toHaveText("Start fresh");
      await expect(card.getByTestId("run-failure-summarize")).toBeEnabled();
      await expect.poll(() => selectedStatus(window)).toBe("failed");
    });

    await test.step("Summarize and try again says when there is nothing to summarize", async () => {
      await card.getByTestId("run-failure-summarize").click();
      const failed = window.locator(
        '[data-testid="run-failure-card"][data-failure-kind="compaction-failed"]',
      );
      await expect(failed).toBeVisible({ timeout: 30_000 });
      await expect(failed).toContainText(
        "The local AI couldn’t summarize this conversation to make room.",
      );
      await expect(failed).toContainText("Nothing to compact");
      // Only the newest card offers actions; Start fresh comes first now.
      await expect(window.getByTestId("run-failure-summarize")).toHaveCount(1);
      await expect(failed.locator("button").first()).toHaveText("Start fresh");
      // The resend never happened: only the original turn reached the model.
      expect(server.requests.filter((request) => !isSummaryRequest(request))).toHaveLength(1);
    });

    await test.step("Start fresh clears the conversation", async () => {
      await window.getByTestId("run-failure-startFresh").click();
      await expectNewThreadWorkspace(window, workspacePath);
      await expect(window.getByTestId("clear-conversation-notice")).toBeVisible();
    });
  } finally {
    await harness.close();
    await server.close();
  }
});

test("the original failure: a large prompt, a 16k window and a failed summary", async () => {
  test.setTimeout(120_000);
  // The local server answers every request, the summary included, with "length" after one
  // token and no text, as llama.cpp did once the prompt filled its 16k window.
  const { server, harness } = await launch("run-failure-original", () => OUT_OF_ROOM, 16_384);
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Too long");
    await send(window, `Please read all of this. ${"Lots of pasted text. ".repeat(2_000)}`);
    const card = window.getByTestId("run-failure-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-failure-kind", "compaction-failed");
    await expect(card).toContainText(
      "The local AI couldn’t summarize this conversation to make room.",
    );
    await expect(card).toContainText("Context overflow recovery failed");
    await expect(card.getByTestId("run-failure-startFresh")).toBeEnabled();
    await expect(card.getByTestId("run-failure-summarize")).toBeEnabled();
    expect(server.requests.some(isSummaryRequest)).toBe(true);
    await expect.poll(() => selectedStatus(window)).toBe("failed");
  } finally {
    await harness.close();
    await server.close();
  }
});

/** Two long answers, then a third turn whose first try finds the context full. */
function overflowOnThirdTurn(summary: () => ScriptedReply) {
  let summarized = false;
  return (request: ScriptedChatRequest): ScriptedReply => {
    if (isSummaryRequest(request)) {
      summarized = true;
      return summary();
    }
    if (lastUserText(request).includes("third")) {
      return summarized ? { text: "Answer after making room." } : OUT_OF_ROOM;
    }
    // Real token counts keep pi's threshold summary out of the first two turns.
    return { text: LONG_REPLY, usage: { prompt: 2_000, completion: 1_700 } };
  };
}

test("pi's own summary failing ends the turn with a compaction error card; a retry recovers", async () => {
  test.setTimeout(120_000);
  // pi retries a failed summary itself, so it keeps failing until the test allows it.
  let summaryWorks = false;
  const { server, harness } = await launch(
    "run-failure-compaction-failed",
    overflowOnThirdTurn(() =>
      summaryWorks
        ? { text: "## Goal\nAnswer three questions.", delayMs: 1_500 }
        : { httpStatus: 400, error: "summary model unavailable" },
    ),
    8_192,
  );
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Summary fails");
    const transcript = window.getByTestId("transcript");
    for (const turn of ["first question", "second question"]) {
      await send(window, turn);
      // The first reply already shows "End of answer.", so wait for this turn's own request.
      await expect
        .poll(() => server.requests.some((request) => lastUserText(request).includes(turn)))
        .toBe(true);
      await expect(transcript).toContainText("End of answer.");
      await expect.poll(() => selectedStatus(window)).toBe("idle");
    }
    await send(window, "third question");
    const card = window.getByTestId("run-failure-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-failure-kind", "compaction-failed");
    await expect(card).toContainText("Context overflow recovery failed");
    await expect(card.getByTestId("run-failure-startFresh")).toBeEnabled();
    await expect(card.getByTestId("run-failure-summarize")).toBeEnabled();
    expect(server.requests.some(isSummaryRequest)).toBe(true);
    await expect(window.getByTestId("timeline-compacting")).toHaveCount(0);

    await test.step("Summarize and try again summarizes, then sends the message again", async () => {
      summaryWorks = true;
      await card.getByTestId("run-failure-summarize").click();
      // The buttons wait while the summary runs.
      await expect(card.getByTestId("run-failure-startFresh")).toBeDisabled();
      await expect(transcript).toContainText("Answer after making room.", { timeout: 30_000 });
      await expect(window.getByTestId("timeline-compaction-divider")).toHaveText(
        "Summarized earlier messages to make room",
      );
      await expect(window.getByTestId("run-failure-card")).toHaveCount(0);
      await expect.poll(() => selectedStatus(window)).toBe("idle");
      const resent = server.requests.filter(
        (request) => !isSummaryRequest(request) && lastUserText(request) === "third question",
      );
      expect(resent).toHaveLength(2);
    });
  } finally {
    await harness.close();
    await server.close();
  }
});

test("pi's own summary succeeding shows the summarizing line, then the reply", async () => {
  test.setTimeout(120_000);
  const { server, harness } = await launch(
    "run-failure-compaction-recovers",
    overflowOnThirdTurn(() => ({
      text: "## Goal\nAnswer three questions.",
      delayMs: 2_500,
    })),
    8_192,
  );
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Summary works");
    const transcript = window.getByTestId("transcript");
    for (const turn of ["first question", "second question"]) {
      await send(window, turn);
      // The first reply already shows "End of answer.", so wait for this turn's own request.
      await expect
        .poll(() => server.requests.some((request) => lastUserText(request).includes(turn)))
        .toBe(true);
      await expect(transcript).toContainText("End of answer.");
      await expect.poll(() => selectedStatus(window)).toBe("idle");
    }
    await send(window, "third question");
    const compacting = window.getByTestId("timeline-compacting");
    await expect(compacting).toHaveText("Summarizing earlier messages to make room…", {
      timeout: 30_000,
    });
    // The summarizing line is the working line, and the thread is busy, not idle.
    await expect(window.getByTestId("timeline-working")).toHaveCount(0);
    expect(await selectedStatus(window)).toBe("running");

    await expect(transcript).toContainText("Answer after making room.", { timeout: 30_000 });
    await expect(compacting).toHaveCount(0);
    await expect(window.getByTestId("timeline-compaction-divider")).toHaveText(
      "Summarized earlier messages to make room",
    );
    await expect(window.getByTestId("run-failure-card")).toHaveCount(0);
    await expect.poll(() => selectedStatus(window)).toBe("idle");
  } finally {
    await harness.close();
    await server.close();
  }
});
