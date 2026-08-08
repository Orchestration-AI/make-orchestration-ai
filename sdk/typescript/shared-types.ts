// Shared types and utilities for Orchestration AI services.
// This module has no external dependencies and can be consumed by any runtime.

// --- Types ---

export type AgentIdentity = {
  agentId: string;
  agentName: string;
  layerId: string;
  layerIndex: number;
  numberOfLayers: number;
  orchestrationId: string;
  workspaceId: string;
  workspaceOwnerId: string;
};

export type Setting =
  | { setting_name: string; setting_description: string; setting_type: "Text"; text_value: string }
  | { setting_name: string; setting_description: string; setting_type: "Boolean"; boolean_value: boolean }
  | { setting_name: string; setting_description: string; setting_type: "Secret"; text_value: string };

export type ServiceInfo = {
  unique_name: string;
  service_name: string;
  service_description: string;
};

export type ServiceDescriptionParameters = Record<
  string,
  {
    optional: boolean;
    description: string;
  } & (
    | { type: "string" | "boolean" | "number" }
    | { type: "enum"; options: string[] }
    | { type: "object"; properties: ServiceDescriptionParameters }
  )
>;

export type ServiceDescriptionPart = {
  path: string;
  description: string;
  method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT";
  parameters: ServiceDescriptionParameters;
};

export type ServiceDescription = ServiceDescriptionPart[];

export type PermissionName =
  | "role_workspace_inserter"
  | "role_workspace_reader"
  | "role_workspace_lister"
  | "role_workspace_updater"
  | "role_workspace_deleter"
  | "role_workspace_writer"
  | "role_workspace_admin"
  | "role_orchestration_inserter"
  | "role_orchestration_reader"
  | "role_orchestration_lister"
  | "role_orchestration_updater"
  | "role_orchestration_deleter"
  | "role_orchestration_writer"
  | "role_orchestration_admin"
  | "role_agent_inserter"
  | "role_agent_reader"
  | "role_agent_lister"
  | "role_agent_updater"
  | "role_agent_deleter"
  | "role_agent_writer"
  | "role_agent_admin"
  | "role_application_inserter"
  | "role_application_reader"
  | "role_application_lister"
  | "role_application_updater"
  | "role_application_deleter"
  | "role_application_writer"
  | "role_application_admin"
  | "role_access_inserter"
  | "role_access_reader"
  | "role_access_lister"
  | "role_access_deleter"
  | "role_access_writer"
  | "role_access_admin"
  | "role_llm_keys_inserter"
  | "role_llm_keys_reader"
  | "role_llm_keys_lister"
  | "role_llm_keys_updater"
  | "role_llm_keys_writer"
  | "role_llm_keys_admin"
  | "role_llm_reader"
  | "role_llm_lister"
  | "role_service_reader"
  | "role_service_lister"
  | "role_day_pass_transaction_lister"
  | "role_storage_layer_reader"
  | "role_storage_layer_writer"
  | "role_storage_agent_reader"
  | "role_storage_agent_writer"
  | "role_storage_orchestration_reader"
  | "role_storage_orchestration_writer"
  | "role_storage_workspace_reader"
  | "role_storage_workspace_writer"
  | "role_ticker_config_reader"
  | "role_ticker_config_updater"
  | "role_task_inserter"
  | "role_task_reader"
  | "role_task_lister"
  | "role_task_deleter"
  | "role_admin";

export type Permission = {
  permission_name: PermissionName;
  justification: string;
};

export type Context = {
  identity: AgentIdentity;
  sessionId?: string;
};

export type MediaBlock = {
  type: "image" | "audio";
  mimeType: string;
  data: string;
};

export type ImageGenOptions = {
  size?: "1024x1024" | "1792x1024" | "1024x1792" | "256x256" | "512x512";
};

export type AudioGenOptions = {
  voice?: "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer";
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number;
};

export type Message = {
  message?: string;
  media?: MediaBlock[];
  imageOptions?: ImageGenOptions;
  audioOptions?: AudioGenOptions;
};

export type InferResponse =
  | { message: string; media: MediaBlock[] }
  | string;

// --- Setting Utilities ---

export function getBooleanSetting(settings: Setting[], key: string): boolean {
  const setting = settings.find((s) => s.setting_name === key);
  if (setting?.setting_type === "Boolean") {
    return setting.boolean_value;
  }
  return false;
}

export function getTextSetting(settings: Setting[], key: string): string | undefined {
  const setting = settings.find((s) => s.setting_name === key);
  if (setting?.setting_type === "Text") {
    return setting.text_value;
  }
  return undefined;
}

export function getSecretSetting(settings: Setting[], key: string): string | undefined {
  const setting = settings.find((s) => s.setting_name === key);
  if (setting?.setting_type === "Secret") {
    return setting.text_value;
  }
  return undefined;
}
