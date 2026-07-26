import type { Context, ServiceDescription, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import {
  WORKSPACE_READ_KEY, WORKSPACE_WRITE_KEY,
  ORCHESTRATION_READ_KEY, ORCHESTRATION_WRITE_KEY,
} from "./oai-files.constants.ts";

export function boolSetting(settings: Setting[], key: string): boolean {
  const s = settings.find((s) => s.setting_name === key);
  return s?.setting_type === "Boolean" ? s.boolean_value : false;
}

export async function loadSettings(context: Context, apiClient: Client): Promise<Setting[]> {
  const { data } = await settingFindByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
  });
  return (data?.settings ?? []) as Setting[];
}

const UPLOAD_URL_NOTE = "Returns upload_url, expires_at, and max_size_bytes. To upload, PUT the file bytes directly to upload_url with two required headers: 'Content-Type: <your content_type>' and 'x-goog-content-length-range: 0,<max_size_bytes>'. Both headers are mandatory - omitting either will result in a 400 error from GCS.";

const writeTextParams = {
  path: { type: "string" as const, optional: false, description: "Destination file path (e.g. 'notes/summary.txt')." },
  content: { type: "string" as const, optional: false, description: "Text content to write to the file." },
  content_type: { type: "string" as const, optional: true, description: "MIME type of the file. Defaults to text/plain." },
};

export async function getOaiFilesDescription(
  context: Context,
  _engineClient: Client,
  apiClient: Client,
): Promise<ServiceDescription> {
  const settings = await loadSettings(context, apiClient);
  const workspaceRead = boolSetting(settings, WORKSPACE_READ_KEY);
  const workspaceWrite = boolSetting(settings, WORKSPACE_WRITE_KEY);
  const orchRead = boolSetting(settings, ORCHESTRATION_READ_KEY);
  const orchWrite = boolSetting(settings, ORCHESTRATION_WRITE_KEY);

  return [
    // ── Agent scope (always visible) ───────────────────────────────────────────
    {
      path: "list_files_agent",
      method: "POST",
      description: "Part of OAI Files. Lists files and subdirectories at the given path in agent-scoped storage.",
      parameters: {
        path: { type: "string", optional: true, description: "Directory path to list. Omit for root." },
      },
    },
    {
      path: "list_files_layer",
      method: "POST",
      description: "Part of OAI Files. Lists files and subdirectories at the given path in layer-scoped storage.",
      parameters: {
        path: { type: "string", optional: true, description: "Directory path to list. Omit for root." },
      },
    },
    {
      path: "get_download_url_agent",
      method: "POST",
      description: "Part of OAI Files. Returns a signed download URL for a file in agent-scoped storage. GET the returned download_url to retrieve the file bytes.",
      parameters: {
        path: { type: "string", optional: false, description: "Path to the file." },
      },
    },
    {
      path: "get_download_url_layer",
      method: "POST",
      description: "Part of OAI Files. Returns a signed download URL for a file in layer-scoped storage. GET the returned download_url to retrieve the file bytes.",
      parameters: {
        path: { type: "string", optional: false, description: "Path to the file." },
      },
    },
    {
      path: "get_upload_url_agent",
      method: "POST",
      description: `Part of OAI Files. ${UPLOAD_URL_NOTE} Scope: agent.`,
      parameters: {
        path: { type: "string", optional: false, description: "Destination path for the file." },
        content_type: { type: "string", optional: false, description: "MIME type of the file (e.g. application/pdf)." },
      },
    },
    {
      path: "get_upload_url_layer",
      method: "POST",
      description: `Part of OAI Files. ${UPLOAD_URL_NOTE} Scope: layer.`,
      parameters: {
        path: { type: "string", optional: false, description: "Destination path for the file." },
        content_type: { type: "string", optional: false, description: "MIME type of the file." },
      },
    },
    {
      path: "write_text_agent",
      method: "POST",
      description: "Part of OAI Files. Writes text content directly to a file in agent-scoped storage. Use this instead of get_upload_url when the content is a string the agent already has.",
      parameters: writeTextParams,
    },
    {
      path: "write_text_layer",
      method: "POST",
      description: "Part of OAI Files. Writes text content directly to a file in layer-scoped storage.",
      parameters: writeTextParams,
    },
    {
      path: "delete_file_agent",
      method: "POST",
      description: "Part of OAI Files. Permanently deletes a file from agent-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Path to the file to delete." },
      },
    },
    {
      path: "delete_file_layer",
      method: "POST",
      description: "Part of OAI Files. Permanently deletes a file from layer-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Path to the file to delete." },
      },
    },
    {
      path: "create_dir_agent",
      method: "POST",
      description: "Part of OAI Files. Creates a directory in agent-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Directory path to create." },
      },
    },
    {
      path: "create_dir_layer",
      method: "POST",
      description: "Part of OAI Files. Creates a directory in layer-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Directory path to create." },
      },
    },
    {
      path: "delete_dir_agent",
      method: "POST",
      description: "Part of OAI Files. Recursively deletes a directory and all its contents from agent-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Directory path to delete." },
      },
    },
    {
      path: "delete_dir_layer",
      method: "POST",
      description: "Part of OAI Files. Recursively deletes a directory and all its contents from layer-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Directory path to delete." },
      },
    },
    {
      path: "get_file_metadata_agent",
      method: "POST",
      description: "Part of OAI Files. Returns metadata for a file in agent-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Path to the file." },
      },
    },
    {
      path: "get_file_metadata_layer",
      method: "POST",
      description: "Part of OAI Files. Returns metadata for a file in layer-scoped storage.",
      parameters: {
        path: { type: "string", optional: false, description: "Path to the file." },
      },
    },

    // ── Orchestration scope (gated) ────────────────────────────────────────────
    ...(orchRead ? [
      {
        path: "list_files_orchestration" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Lists files and subdirectories at the given path in orchestration-scoped storage.",
        parameters: { path: { type: "string" as const, optional: true, description: "Directory path to list. Omit for root." } },
      },
      {
        path: "get_download_url_orchestration" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Returns a signed download URL for a file in orchestration-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Path to the file." } },
      },
      {
        path: "get_file_metadata_orchestration" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Returns metadata for a file in orchestration-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Path to the file." } },
      },
    ] : []),
    ...(orchWrite ? [
      {
        path: "get_upload_url_orchestration" as const,
        method: "POST" as const,
        description: `Part of OAI Files. ${UPLOAD_URL_NOTE} Scope: orchestration.`,
        parameters: {
          path: { type: "string" as const, optional: false, description: "Destination path for the file." },
          content_type: { type: "string" as const, optional: false, description: "MIME type of the file." },
        },
      },
      {
        path: "write_text_orchestration" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Writes text content directly to a file in orchestration-scoped storage.",
        parameters: writeTextParams,
      },
      {
        path: "delete_file_orchestration" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Permanently deletes a file from orchestration-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Path to the file to delete." } },
      },
      {
        path: "create_dir_orchestration" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Creates a directory in orchestration-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Directory path to create." } },
      },
      {
        path: "delete_dir_orchestration" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Recursively deletes a directory and all its contents from orchestration-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Directory path to delete." } },
      },
    ] : []),

    // ── Workspace scope (gated) ────────────────────────────────────────────────
    ...(workspaceRead ? [
      {
        path: "list_files_workspace" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Lists files and subdirectories at the given path in workspace-scoped storage.",
        parameters: { path: { type: "string" as const, optional: true, description: "Directory path to list. Omit for root." } },
      },
      {
        path: "get_download_url_workspace" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Returns a signed download URL for a file in workspace-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Path to the file." } },
      },
      {
        path: "get_file_metadata_workspace" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Returns metadata for a file in workspace-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Path to the file." } },
      },
    ] : []),
    ...(workspaceWrite ? [
      {
        path: "get_upload_url_workspace" as const,
        method: "POST" as const,
        description: `Part of OAI Files. ${UPLOAD_URL_NOTE} Scope: workspace.`,
        parameters: {
          path: { type: "string" as const, optional: false, description: "Destination path for the file." },
          content_type: { type: "string" as const, optional: false, description: "MIME type of the file." },
        },
      },
      {
        path: "write_text_workspace" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Writes text content directly to a file in workspace-scoped storage.",
        parameters: writeTextParams,
      },
      {
        path: "delete_file_workspace" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Permanently deletes a file from workspace-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Path to the file to delete." } },
      },
      {
        path: "create_dir_workspace" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Creates a directory in workspace-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Directory path to create." } },
      },
      {
        path: "delete_dir_workspace" as const,
        method: "POST" as const,
        description: "Part of OAI Files. Recursively deletes a directory and all its contents from workspace-scoped storage.",
        parameters: { path: { type: "string" as const, optional: false, description: "Directory path to delete." } },
      },
    ] : []),
  ];
}
