import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  createNamedThread,
  getDesktopState,
} from "../helpers/electron-app";

for (const legacyMigration of [false, true]) {
  test(`invalid saved attachments remain intact${legacyMigration ? " during legacy migration" : ""} and report a startup diagnostic`, async () => {
    const userDataDir = await makeUserDataDir();
    const workspacePath = await makeWorkspace("invalid-attachments");
    const first = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    let key = "";
    try {
      const window = await first.firstWindow();
      await createNamedThread(window, "Attachment recovery");
      const state = await getDesktopState(window);
      key = `${state.selectedWorkspaceId}:${state.selectedSessionId}`;
    } finally {
      await first.close();
    }
    const attachmentDir = join(userDataDir, "attachments");
    await mkdir(attachmentDir, { recursive: true });
    const attachmentPath = join(attachmentDir, `${encodeURIComponent(key)}.json`);
    const original =
      '[{"id":"retained","kind":"image","name":"retained.png","mimeType":"image/png","data":"eA=="},null]';
    await writeFile(attachmentPath, original);
    const uiStatePath = join(userDataDir, "ui-state.json");
    if (legacyMigration) {
      const saved = JSON.parse(await readFile(uiStatePath, "utf8")) as Record<string, unknown>;
      saved.composerAttachmentsBySession = {
        [key]: [{ id: "legacy", name: "legacy.png", mimeType: "image/png", data: "eA==" }],
      };
      await writeFile(uiStatePath, JSON.stringify(saved));
    }
    const originalUi = await readFile(uiStatePath, "utf8");
    const second = await launchDesktop(userDataDir, { testMode: "background" });
    try {
      const window = await second.firstWindow();
      await expect(window.getByTestId("startup-diagnostics")).toContainText(/attachment/i);
      expect(await readFile(attachmentPath, "utf8")).toBe(original);
    } finally {
      await second.close();
    }
    expect(await readFile(attachmentPath, "utf8")).toBe(original);
    expect(await readFile(uiStatePath, "utf8")).toBe(originalUi);
  });
}

test("invalid catalog reports recovery trouble without pruning attachments across restart", async () => {
  const userDataDir = await makeUserDataDir();
  const catalogPath = join(userDataDir, "catalogs.json");
  const original = JSON.stringify({
    version: 2,
    workspaces: [],
    sessions: [null],
    worktrees: [],
    sessionFiles: {},
  });
  await writeFile(catalogPath, original);
  const attachmentPath = join(userDataDir, "attachments", "retained.json");
  await mkdir(join(userDataDir, "attachments"), { recursive: true });
  const retainedAttachment = JSON.stringify([
    {
      id: "retained",
      kind: "file",
      name: "evidence.txt",
      mimeType: "text/plain",
      fsPath: "/retained/evidence.txt",
    },
  ]);
  await writeFile(attachmentPath, retainedAttachment);

  for (let attempt = 0; attempt < 2; attempt++) {
    const harness = await launchDesktop(userDataDir, { testMode: "background" });
    try {
      const window = await harness.firstWindow();
      await expect(window.getByTestId("startup-diagnostics")).toContainText(/catalog|sessions/i);
      await expect(window.getByTestId("startup-diagnostics")).toBeVisible();
      expect(await readFile(catalogPath, "utf8")).toBe(original);
      expect(await readFile(attachmentPath, "utf8")).toBe(retainedAttachment);
    } finally {
      await harness.close();
    }
    expect(await readFile(catalogPath, "utf8")).toBe(original);
    expect(await readFile(attachmentPath, "utf8")).toBe(retainedAttachment);
  }
});
