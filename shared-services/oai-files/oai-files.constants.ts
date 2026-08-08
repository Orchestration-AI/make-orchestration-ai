import type { Setting } from "@orchestration-ai/sdk/services";

export const WORKSPACE_READ_KEY = "STORAGE_WORKSPACE_READ";
export const WORKSPACE_WRITE_KEY = "STORAGE_WORKSPACE_WRITE";
export const ORCHESTRATION_READ_KEY = "STORAGE_ORCHESTRATION_READ";
export const ORCHESTRATION_WRITE_KEY = "STORAGE_ORCHESTRATION_WRITE";

export const defaultSettings: Setting[] = [
  {
    setting_name: WORKSPACE_READ_KEY,
    setting_description: "Allow this agent to list and download files from workspace-scoped storage.",
    setting_type: "Boolean",
    boolean_value: false,
  },
  {
    setting_name: WORKSPACE_WRITE_KEY,
    setting_description: "Allow this agent to upload, delete, and manage directories in workspace-scoped storage.",
    setting_type: "Boolean",
    boolean_value: false,
  },
  {
    setting_name: ORCHESTRATION_READ_KEY,
    setting_description: "Allow this agent to list and download files from orchestration-scoped storage.",
    setting_type: "Boolean",
    boolean_value: false,
  },
  {
    setting_name: ORCHESTRATION_WRITE_KEY,
    setting_description: "Allow this agent to upload, delete, and manage directories in orchestration-scoped storage.",
    setting_type: "Boolean",
    boolean_value: false,
  },
];
