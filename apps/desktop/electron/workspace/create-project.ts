import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { checkProjectName, type CreateProjectInput } from "../../contracts/projects";
import { isolatedGitEnvironment } from "../platform/files/git-environment";

export type ProjectFolderOutcome =
  | { readonly kind: "created" | "opened"; readonly path: string }
  | { readonly kind: "exists"; readonly path: string };

const GIT_INIT_TIMEOUT_MS = 10_000;

/**
 * Makes `<parentDir>/<name>` for Create project, or finds the one already there.
 * An existing folder is never written to: it is reported, or with `openExisting`
 * returned for the caller to add as a workspace.
 */
export async function createProjectFolder(
  input: CreateProjectInput,
): Promise<ProjectFolderOutcome> {
  const check = checkProjectName(input.name);
  if (!check.ok) {
    throw new Error(`Invalid project name (${check.problem}).`);
  }
  if (!isAbsolute(input.parentDir)) {
    throw new Error("The project location must be an absolute folder path.");
  }
  const parentDir = resolve(input.parentDir);
  const projectPath = join(parentDir, check.name);

  if (input.openExisting) {
    const existing = await stat(projectPath).catch(() => undefined);
    if (!existing?.isDirectory()) {
      throw new Error(`There is no folder at ${projectPath}.`);
    }
    return { kind: "opened", path: projectPath };
  }

  await mkdir(parentDir, { recursive: true });
  try {
    // Not recursive, so an existing folder fails with EEXIST instead of being reused.
    await mkdir(projectPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { kind: "exists", path: projectPath };
    }
    throw error;
  }
  await initGitRepository(projectPath);
  return { kind: "created", path: projectPath };
}

/** Runs `git init` when Git is installed. A missing or failing Git leaves a plain folder. */
function initGitRepository(projectPath: string): Promise<void> {
  return new Promise((resolveInit) => {
    execFile(
      "git",
      ["init", "--quiet"],
      { cwd: projectPath, env: isolatedGitEnvironment(), timeout: GIT_INIT_TIMEOUT_MS },
      (error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn("[create-project] git init failed", error.message);
        }
        resolveInit();
      },
    );
  });
}
