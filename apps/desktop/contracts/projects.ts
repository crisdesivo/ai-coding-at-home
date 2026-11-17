import type { DesktopAppState } from "./desktop-state";

/** Longest folder name Create project accepts, after cleaning. */
export const PROJECT_NAME_MAX_LENGTH = 100;

/**
 * The folder (under Documents) Create project suggests before the user picks another one.
 * No spaces: small local models often fail to quote a path that has them.
 */
export const DEFAULT_PROJECTS_FOLDER_NAME = "pi-at-home-projects";

export type ProjectNameProblem = "empty" | "noLetters" | "reserved" | "tooLong";

export type ProjectNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly name: string; readonly problem: ProjectNameProblem };

export interface CreateProjectInput {
  /** What the user typed; main turns it into the folder name and checks it again. */
  readonly name: string;
  /** Absolute folder the project folder is created in. */
  readonly parentDir: string;
  /** Add the folder that already has this name instead of creating one. */
  readonly openExisting?: boolean;
}

export type CreateProjectResult =
  | {
      readonly kind: "created" | "opened";
      readonly path: string;
      readonly state: DesktopAppState;
    }
  | { readonly kind: "exists"; readonly path: string };

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * The folder name for a typed project name: lowercase, accents on Latin letters dropped
 * ("Señal" → "senal"), and every run of
 * spaces or characters other than letters, digits, "." and "_" turned into one "-", with
 * dashes and dots trimmed from both ends ("Checkers game!" → "checkers-game"). Small local
 * models handle such paths without quoting; spaces made their shell commands fail.
 */
export function slugifyProjectName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** Turns a typed project name into its folder name and says whether it can be one on every OS. */
export function checkProjectName(raw: string): ProjectNameCheck {
  const name = slugifyProjectName(raw);
  if (!name) return { ok: false, name, problem: raw.trim() ? "noLetters" : "empty" };
  if (WINDOWS_RESERVED_NAME.test(name)) return { ok: false, name, problem: "reserved" };
  if ([...name].length > PROJECT_NAME_MAX_LENGTH) return { ok: false, name, problem: "tooLong" };
  return { ok: true, name };
}

/** True when a folder path has whitespace, which small models often fail to quote. */
export function pathHasSpaces(path: string): boolean {
  return /\s/.test(path);
}

/** The full path shown while the user types; main builds the real one with node:path. */
export function previewProjectPath(
  parentDir: string,
  name: string,
  platform: NodeJS.Platform,
): string {
  const separator = platform === "win32" ? "\\" : "/";
  const parent = parentDir.endsWith(separator) ? parentDir.slice(0, -1) : parentDir;
  return `${parent}${separator}${name}`;
}
