import process from "node:process";
import type { Setting } from "@orchestration-ai/sdk/services";
import type { Region } from "@deno/sandbox";

export const SANDBOX_WORKSPACE_MOUNT_KEY = "SANDBOX_WORKSPACE_MOUNT";
export const SANDBOX_ORCHESTRATION_MOUNT_KEY = "SANDBOX_ORCHESTRATION_MOUNT";

export const SANDBOX_REGION = (process.env.SANDBOX_REGION ?? "ord") as Region;
export const CONFIG_FILE_PATH = "__sandbox_config__/env-vars.json";
export const OUTPUT_DIR = "sandbox-output";

export const defaultSettings: Setting[] = [
  {
    setting_name: SANDBOX_WORKSPACE_MOUNT_KEY,
    setting_description: "Allow this agent to mount workspace-scoped OAI files into the sandbox VM.",
    setting_type: "Boolean",
    boolean_value: false,
  },
  {
    setting_name: SANDBOX_ORCHESTRATION_MOUNT_KEY,
    setting_description: "Allow this agent to mount orchestration-scoped OAI files into the sandbox VM.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
