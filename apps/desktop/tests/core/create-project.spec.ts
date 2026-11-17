import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  desktopShortcut,
  expectNewThreadWorkspace,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  openNewThread,
  stubNextOpenDialog,
} from "../helpers/electron-app";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function dialog(window: Page) {
  return window.getByTestId("create-project-dialog");
}

async function workspacePaths(window: Page): Promise<string[]> {
  return (await getDesktopState(window)).workspaces.map((workspace) => workspace.path);
}

test("Create project makes a folder, adds it as a workspace and opens New thread on it", async () => {
  test.setTimeout(120_000);
  const userDataDir = await realpath(await makeUserDataDir());
  // Every location here is a temp folder; the harness also points the default away from Documents.
  const projectsRoot = await realpath(await mkdtemp(join(tmpdir(), "pi-create-project-root-")));
  const parentDir = join(projectsRoot, "my projects");
  const harness = await launchDesktop(userDataDir, { testMode: "background" });

  try {
    const window = await harness.firstWindow();
    await expect(window.getByTestId("empty-state")).toBeVisible();

    // Sidebar entry: the dialog starts at the default location and previews the full path.
    await window.getByTestId("sidebar-new-project").click();
    await expect(dialog(window)).toBeVisible();
    await expect(window.getByTestId("create-project-name")).toBeFocused();
    await expect(window.getByTestId("create-project-location")).toHaveText(
      join(userDataDir, "projects"),
    );
    await expect(window.getByTestId("create-project-confirm")).toBeDisabled();
    await expect(window.getByTestId("create-project-spaces-warning")).toBeHidden();

    // Change… uses the native folder picker (stubbed) and the choice is remembered.
    await stubNextOpenDialog(harness, [parentDir]);
    await dialog(window).getByRole("button", { name: "Change…" }).click();
    await expect(window.getByTestId("create-project-location")).toHaveText(parentDir);
    // A location with a space is allowed, with a gentle warning.
    await expect(window.getByTestId("create-project-spaces-warning")).toHaveText(
      "Paths with spaces can confuse the AI; consider a folder without spaces.",
    );

    await window.getByTestId("create-project-name").fill("CON");
    await expect(dialog(window).getByRole("alert")).toContainText("Windows reserves this name");
    await expect(window.getByTestId("create-project-confirm")).toBeDisabled();

    // The typed name becomes a folder name without spaces, shown live as the user types.
    await window.getByTestId("create-project-name").fill("  Garden: plans ");
    const projectPath = join(parentDir, "garden-plans");
    await expect(window.getByTestId("create-project-folder-name")).toHaveText(
      "“Garden: plans” becomes the folder “garden-plans”",
    );
    await expect(window.getByTestId("create-project-path")).toHaveText(
      `Will create ${projectPath}`,
    );
    await window.getByTestId("create-project-name").fill("Checkers game!");
    await expect(window.getByTestId("create-project-path")).toHaveText(
      `Will create ${join(parentDir, "checkers-game")}`,
    );
    await window.getByTestId("create-project-name").fill("  Garden: plans ");
    await window.getByTestId("create-project-confirm").click();

    await expect(dialog(window)).toBeHidden();
    expect((await stat(projectPath)).isDirectory()).toBe(true);
    if (gitAvailable()) {
      expect((await stat(join(projectPath, ".git"))).isDirectory()).toBe(true);
    }
    await expectNewThreadWorkspace(window, projectPath);
    await expect(window.getByTestId("new-thread-composer")).toBeFocused();
    await expect(window.getByTestId("workspace-list")).toContainText("garden-plans");

    const uiState = JSON.parse(await readFile(join(userDataDir, "ui-state.json"), "utf8")) as {
      projectParentDir?: string;
    };
    expect(uiState.projectParentDir).toBe(parentDir);

    // The command palette lists the action too.
    await window.keyboard.press(desktopShortcut("K"));
    await expect(window.getByTestId("command-palette")).toBeVisible();
    await window.keyboard.type("create project");
    await window
      .getByTestId("command-palette")
      .getByRole("option", { name: /Create project…/ })
      .click();
    await expect(dialog(window)).toBeVisible();
    await expect(window.getByTestId("create-project-location")).toHaveText(parentDir);
    await window.keyboard.press("Escape");
    await expect(dialog(window)).toBeHidden();

    // So does the folder-with-a-plus icon next to the Open folder icon.
    await window.getByTestId("sidebar-create-project-icon").click();
    await expect(dialog(window)).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(dialog(window)).toBeHidden();
  } finally {
    await harness.close();
  }
});

test("Create project never reuses an existing folder but offers to open it", async () => {
  test.setTimeout(120_000);
  const userDataDir = await realpath(await makeUserDataDir());
  const firstProject = await realpath(await mkdtemp(join(tmpdir(), "pi-create-project-first-")));
  const defaultParent = join(userDataDir, "projects");
  const existingPath = join(defaultParent, "existing-notes");
  await mkdir(existingPath, { recursive: true });
  await writeFile(join(existingPath, "notes.txt"), "keep me\n", "utf8");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [firstProject],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    // New thread's folder picker has a "Create a new project…" entry.
    await window.locator(".new-thread__workspace").selectOption({ label: "Create a new project…" });
    await expect(dialog(window)).toBeVisible();
    await expect(window.getByTestId("create-project-location")).toHaveText(defaultParent);

    // "Existing Notes" becomes the folder "existing-notes", which is already there.
    await window.getByTestId("create-project-name").fill("Existing Notes");
    await window.getByTestId("create-project-confirm").click();
    const exists = window.getByTestId("create-project-exists");
    await expect(exists).toContainText("A folder with this name already exists");
    await expect(window.getByTestId("create-project-confirm")).toBeDisabled();
    expect(await workspacePaths(window)).not.toContain(existingPath);

    await exists.getByRole("button", { name: "Open it instead" }).click();
    await expect(dialog(window)).toBeHidden();
    await expectNewThreadWorkspace(window, existingPath);
    await expect(window.getByTestId("new-thread-composer")).toBeFocused();
    expect(await readdir(existingPath)).toEqual(["notes.txt"]);
    expect(await readFile(join(existingPath, "notes.txt"), "utf8")).toBe("keep me\n");
  } finally {
    await harness.close();
  }
});
