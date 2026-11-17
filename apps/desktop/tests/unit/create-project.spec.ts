import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  checkProjectName,
  DEFAULT_PROJECTS_FOLDER_NAME,
  pathHasSpaces,
  previewProjectPath,
  PROJECT_NAME_MAX_LENGTH,
  slugifyProjectName,
} from "../../contracts/projects";
import { createProjectFolder } from "../../electron/workspace/create-project";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("project names become lowercase folder names with dashes instead of spaces", () => {
  expect(slugifyProjectName("Checkers game!")).toBe("checkers-game");
  expect(slugifyProjectName("  My project  ")).toBe("my-project");
  expect(slugifyProjectName('a\\b/c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  expect(slugifyProjectName("tab\there\u0000nul\u007fdel")).toBe("tab-here-nul-del");
  expect(slugifyProjectName("--Hello   ---  World--")).toBe("hello-world");
  expect(slugifyProjectName("Ñandú — Señal 2026")).toBe("nandu-senal-2026");
  expect(slugifyProjectName("Café ✨ notes")).toBe("cafe-notes");
  expect(slugifyProjectName("v1.2 release_notes")).toBe("v1.2-release_notes");
  expect(slugifyProjectName(".hidden.")).toBe("hidden");
  expect(slugifyProjectName("项目 笔记")).toBe("项目-笔记");
  expect(checkProjectName(" Budget 2026 ")).toEqual({ ok: true, name: "budget-2026" });
  expect(checkProjectName("Q1/Q2 plan")).toEqual({ ok: true, name: "q1-q2-plan" });
});

test("project names that cannot be a folder everywhere are rejected", () => {
  expect(checkProjectName("")).toMatchObject({ ok: false, problem: "empty" });
  expect(checkProjectName("   ")).toMatchObject({ ok: false, problem: "empty" });
  expect(checkProjectName(".")).toMatchObject({ ok: false, problem: "noLetters" });
  expect(checkProjectName(" .. ")).toMatchObject({ ok: false, problem: "noLetters" });
  expect(checkProjectName("!!!")).toMatchObject({ ok: false, problem: "noLetters" });
  for (const reserved of ["CON", "prn", "Aux", "nul", "COM1", "com9", "LPT1", "lpt9", "con.txt"]) {
    expect(checkProjectName(reserved)).toMatchObject({ ok: false, problem: "reserved" });
  }
  expect(checkProjectName("COM10")).toMatchObject({ ok: true, name: "com10" });
  expect(checkProjectName("console")).toMatchObject({ ok: true });
  expect(checkProjectName("notes.")).toMatchObject({ ok: true, name: "notes" });
  expect(checkProjectName("a".repeat(PROJECT_NAME_MAX_LENGTH))).toMatchObject({ ok: true });
  expect(checkProjectName("a".repeat(PROJECT_NAME_MAX_LENGTH + 1))).toMatchObject({
    ok: false,
    problem: "tooLong",
  });
});

test("the default projects folder and a picked location are checked for spaces", () => {
  expect(DEFAULT_PROJECTS_FOLDER_NAME).toBe("pi-at-home-projects");
  expect(pathHasSpaces(DEFAULT_PROJECTS_FOLDER_NAME)).toBe(false);
  expect(pathHasSpaces("/home/me/Documents/pi-at-home-projects")).toBe(false);
  expect(pathHasSpaces("/home/me/Outputs/pi at home projects")).toBe(true);
  expect(pathHasSpaces("C:\\Users\\Jane Doe\\Documents")).toBe(true);
});

test("the path preview joins the location and name with the platform separator", () => {
  expect(previewProjectPath("/home/me/projects", "Notes", "linux")).toBe("/home/me/projects/Notes");
  expect(previewProjectPath("/", "Notes", "darwin")).toBe("/Notes");
  expect(previewProjectPath("C:\\Users\\me\\", "Notes", "win32")).toBe("C:\\Users\\me\\Notes");
});

test("creating a project makes the parent and folder, and never reuses an existing one", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-create-project-"));
  try {
    const parentDir = join(root, "nested", "projects");
    const created = await createProjectFolder({ name: " Garden: plans ", parentDir });
    expect(created).toEqual({ kind: "created", path: join(parentDir, "garden-plans") });
    expect((await stat(created.path)).isDirectory()).toBe(true);
    if (gitAvailable()) {
      expect((await stat(join(created.path, ".git"))).isDirectory()).toBe(true);
    }

    await writeFile(join(created.path, "keep.txt"), "mine");
    const again = await createProjectFolder({ name: "Garden: plans", parentDir });
    expect(again).toEqual({ kind: "exists", path: created.path });
    expect(await readdir(created.path)).toContain("keep.txt");

    const opened = await createProjectFolder({
      name: "Garden: plans",
      parentDir,
      openExisting: true,
    });
    expect(opened).toEqual({ kind: "opened", path: created.path });

    await expect(
      createProjectFolder({ name: "missing", parentDir, openExisting: true }),
    ).rejects.toThrow("There is no folder");
    await expect(createProjectFolder({ name: "CON", parentDir })).rejects.toThrow(
      "Invalid project name",
    );
    await expect(createProjectFolder({ name: "ok", parentDir: "relative/dir" })).rejects.toThrow(
      "absolute",
    );

    // A file with the project's name counts as taken too.
    await mkdir(join(root, "files"));
    await writeFile(join(root, "files", "taken"), "");
    // Names that slug to the same folder find it too.
    expect(await createProjectFolder({ name: "Taken!", parentDir: join(root, "files") })).toEqual({
      kind: "exists",
      path: join(root, "files", "taken"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
