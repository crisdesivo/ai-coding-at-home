import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  DEFAULT_LOCAL_MODEL_CONFIG,
  LOCAL_MODEL_CONFIG_ENV,
  isProviderAuthEnvVar,
  localCompactionSettings,
  localMaxTokens,
  localModelConfigPath,
  localModelsJson,
  parseLocalModelConfig,
  prepareLocalAgentDir,
  probeLocalModel,
  readLocalModelConfig,
  resolveSafeguardPackages,
  scrubProviderAuthEnv,
} from "../../electron/platform/local-model";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

test("uses the defaults when the config file is missing", async () => {
  const dir = await tempDir("local-model-missing-");
  expect(await readLocalModelConfig(join(dir, "local-model.json"))).toEqual(
    DEFAULT_LOCAL_MODEL_CONFIG,
  );
});

test("reads the launcher's config and falls back per field", async () => {
  const dir = await tempDir("local-model-read-");
  const file = join(dir, "local-model.json");
  await writeFile(
    file,
    JSON.stringify({
      baseUrl: "http://127.0.0.1:9090/v1/",
      modelId: "gemma-3-4b",
      contextWindow: 32768,
      reasoning: "yes",
    }),
  );
  expect(await readLocalModelConfig(file)).toEqual({
    baseUrl: "http://127.0.0.1:9090/v1",
    modelId: "gemma-3-4b",
    name: "gemma-3-4b",
    contextWindow: 32768,
    reasoning: false,
  });
  expect(parseLocalModelConfig({ baseUrl: "ftp://nope", contextWindow: -1 })).toEqual(
    DEFAULT_LOCAL_MODEL_CONFIG,
  );
  await writeFile(file, "{ not json");
  expect(await readLocalModelConfig(file)).toEqual(DEFAULT_LOCAL_MODEL_CONFIG);
});

test("finds the config through the env var, else in userData", () => {
  expect(localModelConfigPath({}, "/data")).toBe(join("/data", "local-model.json"));
  expect(localModelConfigPath({ [LOCAL_MODEL_CONFIG_ENV]: " /etc/model.json " }, "/data")).toBe(
    "/etc/model.json",
  );
});

test("models.json offers only the local provider with its one model", () => {
  const models = localModelsJson(DEFAULT_LOCAL_MODEL_CONFIG) as {
    providers: Record<string, Record<string, unknown>>;
  };
  expect(Object.keys(models.providers)).toEqual(["local"]);
  const local = models.providers.local!;
  expect(local).toMatchObject({
    baseUrl: "http://127.0.0.1:8080/v1",
    api: "openai-completions",
    apiKey: "local",
  });
  expect(local.models).toEqual([
    expect.objectContaining({
      id: "qwen3-1.7b",
      name: "Qwen3 1.7B",
      contextWindow: 16384,
      reasoning: false,
      samplingParams: { chat_template_kwargs: { enable_thinking: false } },
    }),
  ]);
});

test("prepares the agent dir and keeps settings it does not own", async () => {
  const agentDir = await tempDir("local-agent-dir-");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      theme: "dark",
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      enabledModels: ["openai/*"],
      packages: ["npm:something"],
    }),
  );
  await writeFile(
    join(agentDir, "auth.json"),
    JSON.stringify({ openai: { type: "api_key", key: "x" } }),
  );
  await prepareLocalAgentDir({
    agentDir,
    config: DEFAULT_LOCAL_MODEL_CONFIG,
    safeguardPackages: ["/res/safeguards/cc-safety-net", "/res/safeguards/pix-gate"],
  });

  const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as unknown;
  expect(settings).toEqual({
    theme: "dark",
    defaultProvider: "local",
    defaultModel: "qwen3-1.7b",
    enabledModels: ["local/qwen3-1.7b"],
    defaultThinkingLevel: "off",
    enableInstallTelemetry: false,
    // 16k window: replies up to 2048 tokens, summarizing starts with 4096 left, last ~3.3k kept.
    compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 3276 },
    packages: ["/res/safeguards/cc-safety-net", "/res/safeguards/pix-gate"],
  });
  expect(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")) as unknown).toEqual({});
  const models = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
    providers: Record<string, unknown>;
  };
  expect(Object.keys(models.providers)).toEqual(["local"]);
});

test("removes every provider credential from the environment", () => {
  const env: NodeJS.ProcessEnv = {
    OPENAI_API_KEY: "a",
    ANTHROPIC_OAUTH_TOKEN: "b",
    AWS_PROFILE: "c",
    PATH: "/bin",
    HOME: "/home/me",
  };
  expect(scrubProviderAuthEnv(env).sort()).toEqual([
    "ANTHROPIC_OAUTH_TOKEN",
    "AWS_PROFILE",
    "OPENAI_API_KEY",
  ]);
  expect(env).toEqual({ PATH: "/bin", HOME: "/home/me" });
  expect(isProviderAuthEnvVar("GEMINI_API_KEY")).toBe(true);
  expect(isProviderAuthEnvVar("PI_CODING_AGENT_DIR")).toBe(false);
});

test("lists the safeguards cc-safety-net first, from resources when packaged", () => {
  const present = new Set([
    join("/app/resources", "safeguards", "cc-safety-net", "package.json"),
    join("/app/resources", "safeguards", "pix-gate", "package.json"),
    join("/opt/pi/resources", "safeguards", "cc-safety-net", "package.json"),
  ]);
  const exists = (path: string) => present.has(path);
  expect(
    resolveSafeguardPackages({
      isPackaged: false,
      resourcesPath: "/opt/pi/resources",
      appResourcesDir: "/app/resources",
      exists,
    }),
  ).toEqual([
    join("/app/resources", "safeguards", "cc-safety-net"),
    join("/app/resources", "safeguards", "pix-gate"),
  ]);
  expect(
    resolveSafeguardPackages({
      isPackaged: true,
      resourcesPath: "/opt/pi/resources",
      appResourcesDir: "/app/resources",
      exists,
    }),
  ).toEqual([join("/opt/pi/resources", "safeguards", "cc-safety-net")]);
});

test("reports the local server as running only when its model list answers", async () => {
  const seen: string[] = [];
  const ok = async (url: string) => {
    seen.push(url);
    return { ok: true };
  };
  expect(await probeLocalModel({ baseUrl: "http://127.0.0.1:8080/v1" }, ok)).toBe(true);
  expect(seen).toEqual(["http://127.0.0.1:8080/v1/models"]);
  expect(await probeLocalModel({ baseUrl: "http://x/v1" }, async () => ({ ok: false }))).toBe(
    false,
  );
  expect(
    await probeLocalModel({ baseUrl: "http://x/v1" }, async () => {
      throw new Error("ECONNREFUSED");
    }),
  ).toBe(false);
});

test("summarizing starts early enough that a full reply always fits", () => {
  for (const contextWindow of [16384, 32768, 65536, 131072]) {
    const config = { ...DEFAULT_LOCAL_MODEL_CONFIG, contextWindow };
    const { reserveTokens, keepRecentTokens } = localCompactionSettings(config);
    // pi starts summarizing once the conversation passes contextWindow - reserveTokens, so the
    // biggest prompt it sends plus the longest reply must still fit the window.
    expect(contextWindow - reserveTokens + localMaxTokens(config)).toBeLessThan(contextWindow);
    // After a summary, pi's instructions (~4k), the summary (up to a full reply) and the kept
    // messages must sit well below the point where summarizing starts, or it loops.
    const afterSummary = 4000 + localMaxTokens(config) + keepRecentTokens;
    expect(afterSummary).toBeLessThan((contextWindow - reserveTokens) * 0.8);
  }
});
