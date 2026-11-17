import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RuntimeSupervisorOptions } from "./runtime-supervisor.js";

export interface RuntimeDependencies {
  readonly agentDir: string;
  readonly modelsJsonPath: string;
  readonly authPath: string;
}

export function createRuntimeDependencies(
  options: RuntimeSupervisorOptions = {},
): RuntimeDependencies {
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  return {
    agentDir,
    modelsJsonPath: join(agentDir, "models.json"),
    authPath: join(agentDir, "auth.json"),
  };
}
