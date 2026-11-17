import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * pi at home runs one local model, served by llama.cpp's OpenAI-compatible server. The launcher
 * that starts llama.cpp writes this file; until it exists the defaults below apply.
 */
export interface LocalModelConfig {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly reasoning: boolean;
  readonly maxTokens?: number;
}

export const LOCAL_PROVIDER_ID = "local";
export const LOCAL_PROVIDER_API_KEY = "local";
export const LOCAL_MODEL_CONFIG_ENV = "PI_AT_HOME_MODEL_CONFIG";
export const LOCAL_MODEL_CONFIG_FILE = "local-model.json";

export const DEFAULT_LOCAL_MODEL_CONFIG: LocalModelConfig = {
  baseUrl: "http://127.0.0.1:8080/v1",
  modelId: "qwen3-1.7b",
  name: "Qwen3 1.7B",
  contextWindow: 16384,
  reasoning: false,
};

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Provider credentials pi reads from the environment that do not end in `_API_KEY`. Any of them
 * would bring a cloud provider back, so they are removed with every `*_API_KEY` variable.
 */
const NON_API_KEY_PROVIDER_ENV_VARS: ReadonlySet<string> = new Set([
  "ANTHROPIC_OAUTH_TOKEN",
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
]);

export function isProviderAuthEnvVar(key: string): boolean {
  return key.endsWith("_API_KEY") || NON_API_KEY_PROVIDER_ENV_VARS.has(key);
}

/** Removes every provider credential from `env` and returns the names it removed. */
export function scrubProviderAuthEnv(env: NodeJS.ProcessEnv): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(env)) {
    if (isProviderAuthEnvVar(key)) {
      delete env[key];
      removed.push(key);
    }
  }
  return removed;
}

export function localModelConfigPath(env: NodeJS.ProcessEnv, userDataDir: string): string {
  return env[LOCAL_MODEL_CONFIG_ENV]?.trim() || join(userDataDir, LOCAL_MODEL_CONFIG_FILE);
}

/**
 * Reads the local model's config. A missing file gives the defaults; a field that is missing or
 * of the wrong type falls back to its default, so a half-written file still starts the app.
 */
export async function readLocalModelConfig(filePath: string): Promise<LocalModelConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_LOCAL_MODEL_CONFIG;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(
      `[pi-at-home] ${filePath} is not valid JSON; using the default local model: ${String(error)}`,
    );
    return DEFAULT_LOCAL_MODEL_CONFIG;
  }
  return parseLocalModelConfig(parsed);
}

export function parseLocalModelConfig(value: unknown): LocalModelConfig {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: string, fallback: string) => {
    const entry = record[key];
    return typeof entry === "string" && entry.trim() ? entry.trim() : fallback;
  };
  const positiveInteger = (key: string) => {
    const entry = record[key];
    return typeof entry === "number" && Number.isInteger(entry) && entry > 0 ? entry : undefined;
  };
  const baseUrl = text("baseUrl", DEFAULT_LOCAL_MODEL_CONFIG.baseUrl).replace(/\/+$/, "");
  const modelId = text("modelId", DEFAULT_LOCAL_MODEL_CONFIG.modelId);
  const maxTokens = positiveInteger("maxTokens");
  return {
    baseUrl: isHttpUrl(baseUrl) ? baseUrl : DEFAULT_LOCAL_MODEL_CONFIG.baseUrl,
    modelId,
    // A file naming another model without its display name shows that model's id.
    name: text(
      "name",
      modelId === DEFAULT_LOCAL_MODEL_CONFIG.modelId ? DEFAULT_LOCAL_MODEL_CONFIG.name : modelId,
    ),
    contextWindow: positiveInteger("contextWindow") ?? DEFAULT_LOCAL_MODEL_CONFIG.contextWindow,
    reasoning:
      typeof record.reasoning === "boolean"
        ? record.reasoning
        : DEFAULT_LOCAL_MODEL_CONFIG.reasoning,
    ...(maxTokens ? { maxTokens } : {}),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host.length > 0;
  } catch {
    return false;
  }
}

/** `models.json` with the local provider as its only provider. */
export function localModelsJson(config: LocalModelConfig): Record<string, unknown> {
  return {
    providers: {
      [LOCAL_PROVIDER_ID]: {
        baseUrl: config.baseUrl,
        api: "openai-completions",
        apiKey: LOCAL_PROVIDER_API_KEY,
        // llama.cpp's server takes the plain system role and none of OpenAI's extra fields.
        compat: {
          supportsDeveloperRole: false,
          supportsStore: false,
          supportsReasoningEffort: false,
        },
        models: [
          {
            id: config.modelId,
            name: config.name,
            reasoning: config.reasoning,
            input: ["text"],
            contextWindow: config.contextWindow,
            maxTokens: localMaxTokens(config),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            // Qwen3-style chat templates think unless told not to, which makes a small local
            // model take minutes per reply; llama.cpp passes these to the template.
            samplingParams: { chat_template_kwargs: { enable_thinking: config.reasoning } },
          },
        ],
      },
    },
  };
}

/** Longest reply (and summary) the model may write: at most an eighth of its context window. */
export function localMaxTokens(config: LocalModelConfig): number {
  return Math.min(
    config.maxTokens ?? DEFAULT_MAX_TOKENS,
    Math.max(1, Math.floor(config.contextWindow / 8)),
  );
}

/**
 * When pi summarizes older messages, sized to the local model. pi's defaults (start when 16k
 * tokens are left, keep the last 20k) are bigger than a small model's whole window, so the
 * conversation filled up and the model had no room left to answer. Here: start summarizing
 * while there is still room for a full reply plus some slack, and keep the last ~20% as is, so
 * that pi's own instructions (~3-4k tokens), the summary and the kept messages fit well below
 * the point where summarizing starts again.
 */
export function localCompactionSettings(config: LocalModelConfig): {
  enabled: true;
  reserveTokens: number;
  keepRecentTokens: number;
} {
  return {
    enabled: true,
    reserveTokens: localMaxTokens(config) + 2048,
    keepRecentTokens: Math.floor(config.contextWindow * 0.2),
  };
}

/** pi's global settings for the local model; keys pi at home does not own are kept. */
export function localAgentSettings(
  existing: Record<string, unknown>,
  config: LocalModelConfig,
  safeguardPackages: readonly string[],
): Record<string, unknown> {
  return {
    ...existing,
    defaultProvider: LOCAL_PROVIDER_ID,
    defaultModel: config.modelId,
    enabledModels: [`${LOCAL_PROVIDER_ID}/${config.modelId}`],
    defaultThinkingLevel: "off",
    enableInstallTelemetry: false,
    compaction: localCompactionSettings(config),
    packages: [...safeguardPackages],
  };
}

export interface PrepareLocalAgentDirOptions {
  readonly agentDir: string;
  readonly config: LocalModelConfig;
  readonly safeguardPackages: readonly string[];
}

/** Writes the agent dir so pi sees the local model and nothing else. Runs on every launch. */
export async function prepareLocalAgentDir(options: PrepareLocalAgentDirOptions): Promise<void> {
  const { agentDir, config, safeguardPackages } = options;
  await mkdir(agentDir, { recursive: true });
  const settingsPath = join(agentDir, "settings.json");
  const existingSettings = await readJsonObject(settingsPath);
  await writeJson(join(agentDir, "models.json"), localModelsJson(config));
  await writeJson(settingsPath, localAgentSettings(existingSettings, config, safeguardPackages));
  // No stored credentials: the local server needs none, and a cloud login must not survive.
  await writeJson(join(agentDir, "auth.json"), {});
}

/**
 * The bundled safeguard packages, cc-safety-net first so it sees each command before pix-gate
 * asks about it. Packaged builds carry them in `resources/safeguards` (electron-builder
 * extraResources); dev and preview builds read them from the app's own `resources/`.
 */
export const SAFEGUARD_PACKAGE_NAMES = ["cc-safety-net", "pix-gate"] as const;

/** pi at home's own extensions (resources/extensions), loaded after the safeguards. */
export const OWN_EXTENSION_NAMES = ["context-guard"] as const;

export function resolveSafeguardPackages(options: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appResourcesDir: string;
  readonly exists?: (path: string) => boolean;
}): string[] {
  const root = options.isPackaged
    ? join(options.resourcesPath, "safeguards")
    : join(options.appResourcesDir, "safeguards");
  const exists = options.exists ?? existsSync;
  const found: string[] = [];
  const ownRoot = options.isPackaged
    ? join(options.resourcesPath, "extensions")
    : join(options.appResourcesDir, "extensions");
  const wanted = [
    ...SAFEGUARD_PACKAGE_NAMES.map((name) => join(root, name)),
    ...OWN_EXTENSION_NAMES.map((name) => join(ownRoot, name)),
  ];
  for (const packageDir of wanted) {
    const name = packageDir.split(/[\\/]/).pop() ?? packageDir;
    if (exists(join(packageDir, "package.json"))) {
      found.push(packageDir);
    } else {
      console.warn(
        `[pi-at-home] Safeguard package ${name} is missing at ${packageDir}; run \`pnpm --filter @pi-gui/desktop vendor:safeguards\`.`,
      );
    }
  }
  return found;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean }>;

/** Whether the local server answers its model list; any failure means it is not running yet. */
export async function probeLocalModel(
  config: Pick<LocalModelConfig, "baseUrl">,
  fetchImpl: FetchLike,
  timeoutMs = 3_000,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${config.baseUrl}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Checks the local server now and then: every few seconds while it is down (it may still be
 * loading the model), less often once it answers. Returns a function that stops checking.
 */
export function monitorLocalModel(options: {
  readonly config: Pick<LocalModelConfig, "baseUrl">;
  readonly fetch: FetchLike;
  readonly onStatus: (reachable: boolean) => void;
  readonly downIntervalMs?: number;
  readonly upIntervalMs?: number;
}): () => void {
  const downIntervalMs = options.downIntervalMs ?? 5_000;
  const upIntervalMs = options.upIntervalMs ?? 30_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async (): Promise<void> => {
    const reachable = await probeLocalModel(options.config, options.fetch);
    if (stopped) {
      return;
    }
    try {
      options.onStatus(reachable);
    } finally {
      timer = setTimeout(schedule, reachable ? upIntervalMs : downIntervalMs);
    }
  };
  const schedule = () => {
    check().catch((error: unknown) => {
      console.error("[pi-at-home] checking the local model failed", error);
    });
  };
  schedule();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
