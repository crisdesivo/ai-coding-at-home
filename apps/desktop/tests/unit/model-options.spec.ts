import { expect, test } from "@playwright/test";
import type {
  RuntimeModelRecord,
  RuntimeModelScope,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import { buildModelOptions } from "../../src/features/conversation/composer-commands";

function model(
  providerId: string,
  modelId: string,
  scope: RuntimeModelScope,
  available = true,
): RuntimeModelRecord {
  return {
    providerId,
    providerName: providerId,
    modelId,
    label: modelId,
    available,
    authType: "api_key",
    reasoning: false,
    supportsImages: false,
    scope,
  };
}

test("model options list the available models pi's enabledModels scope includes", () => {
  const runtime: RuntimeSnapshot = {
    workspace: { workspaceId: "model-options", path: "/model-options" },
    providers: [
      {
        id: "local",
        name: "local",
        hasAuth: true,
        authType: "none",
        authSource: "external",
        oauthSupported: false,
        apiKeySetupSupported: false,
      },
    ],
    models: [
      model("local", "qwen3-1.7b", "listed"),
      model("local", "disabled", "off"),
      model("local", "unavailable", "listed", false),
    ],
    skills: [],
    extensions: [],
    settings: {
      enableSkillCommands: true,
      enabledModelPatterns: ["local/qwen3-1.7b"],
    },
  };

  const options = buildModelOptions(runtime);
  expect(options.map((option) => `${option.providerId}/${option.modelId}`)).toEqual([
    "local/qwen3-1.7b",
  ]);
  // The model's own name, with no provider prefix: there is only one provider.
  expect(options[0]?.label).toBe("qwen3-1.7b");
  expect(buildModelOptions(undefined)).toEqual([]);
});
