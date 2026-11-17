import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const ENGINE_DIR_ENV = "PI_AT_HOME_ENGINE_DIR";

export function serverBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "llama-server.exe" : "llama-server";
}

/** The folder name fetch-engine.mjs uses for each platform under resources/engine/. */
export function enginePlatformFolder(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "win";
  if (platform === "darwin") return "mac";
  return "linux";
}

/**
 * Where the bundled engine lives: `PI_AT_HOME_ENGINE_DIR` when set (dev), else resources/engine
 * (packaged: next to the app's resources; dev and preview: the app's own resources/ folder).
 */
export function bundledEngineRoot(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appResourcesDir: string;
}): string {
  const override = options.env[ENGINE_DIR_ENV]?.trim();
  if (override) {
    return override;
  }
  return options.isPackaged
    ? path.join(options.resourcesPath, "engine")
    : path.join(options.appResourcesDir, "engine");
}

/**
 * Finds llama-server under `root`. Release archives unpack into a nested folder
 * (`llama-b12445/llama-server`), so this searches a few levels down, preferring the current
 * platform's folder when several are present.
 */
export function findServerBinary(
  root: string,
  platform: NodeJS.Platform = process.platform,
  maxDepth = 4,
): string | undefined {
  const binary = serverBinaryName(platform);
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === binary && (entry.isFile() || entry.isSymbolicLink())) {
        found.push(full);
      } else if (entry.isDirectory() && depth < maxDepth) {
        visit(full, depth + 1);
      }
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) {
    visit(root, 0);
  }
  const preferred = enginePlatformFolder(platform);
  found.sort((a, b) => {
    const score = (file: string) =>
      file.split(/[\\/]/).includes(preferred) ? 0 : file.split(/[\\/]/).length;
    return score(a) - score(b);
  });
  return found[0];
}

/** cwd and environment so llama-server finds the libraries next to it. */
export function engineSpawnEnv(serverPath: string): {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
} {
  const dir = path.dirname(serverPath);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.platform === "linux") {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
      ? `${dir}${path.delimiter}${env.LD_LIBRARY_PATH}`
      : dir;
  } else if (process.platform === "win32") {
    env.PATH = env.PATH ? `${dir}${path.delimiter}${env.PATH}` : dir;
  }
  return { cwd: dir, env };
}
