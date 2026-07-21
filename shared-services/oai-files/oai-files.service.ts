import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import {
  storageListDirWorkspace, storageListDirOrch, storageListDirAgent, storageListDirLayer,
  storageDownloadFileWorkspace, storageDownloadFileOrch, storageDownloadFileAgent, storageDownloadFileLayer,
  storageUploadFileWorkspace, storageUploadFileOrch, storageUploadFileAgent, storageUploadFileLayer,
  storageDeleteFileWorkspace, storageDeleteFileOrch, storageDeleteFileAgent, storageDeleteFileLayer,
  storageCreateDirWorkspace, storageCreateDirOrch, storageCreateDirAgent, storageCreateDirLayer,
  storageDeleteDirWorkspace, storageDeleteDirOrch, storageDeleteDirAgent, storageDeleteDirLayer,
  storageFileMetadataWorkspace, storageFileMetadataOrch, storageFileMetadataAgent, storageFileMetadataLayer,
} from "@orchestration-ai/sdk/sdk.gen";

type PathBody = { path?: string };
type FileBody = { path: string };
type UploadBody = { path: string; content_type: string };

function ids(context: Context) {
  const { workspaceId, orchestrationId, agentId, layerId } = context.identity;
  return { workspaceId, orchestrationId, agentId, layerId };
}

// ── List directory ─────────────────────────────────────────────────────────────

export async function listFilesWorkspace(body: PathBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId } = ids(context);
  const { data } = await storageListDirWorkspace({ client: apiClient, path: { workspaceId }, query: { path: body.path } });
  return data;
}

export async function listFilesOrchestration(body: PathBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId } = ids(context);
  const { data } = await storageListDirOrch({ client: apiClient, path: { workspaceId, orchestrationId }, query: { path: body.path } });
  return data;
}

export async function listFilesAgent(body: PathBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId } = ids(context);
  const { data } = await storageListDirAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, query: { path: body.path } });
  return data;
}

export async function listFilesLayer(body: PathBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  const { data } = await storageListDirLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, query: { path: body.path } });
  return data;
}

// ── Get download URL ───────────────────────────────────────────────────────────

export async function getDownloadUrlWorkspace(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId } = ids(context);
  const { data } = await storageDownloadFileWorkspace({ client: apiClient, path: { workspaceId }, query: { path: body.path } });
  return data;
}

export async function getDownloadUrlOrchestration(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId } = ids(context);
  const { data } = await storageDownloadFileOrch({ client: apiClient, path: { workspaceId, orchestrationId }, query: { path: body.path } });
  return data;
}

export async function getDownloadUrlAgent(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId } = ids(context);
  const { data } = await storageDownloadFileAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, query: { path: body.path } });
  return data;
}

export async function getDownloadUrlLayer(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  const { data } = await storageDownloadFileLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, query: { path: body.path } });
  return data;
}

// ── Get upload URL ─────────────────────────────────────────────────────────────

export async function getUploadUrlWorkspace(body: UploadBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId } = ids(context);
  const { data } = await storageUploadFileWorkspace({ client: apiClient, path: { workspaceId }, body: { path: body.path, content_type: body.content_type } });
  return data;
}

export async function getUploadUrlOrchestration(body: UploadBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId } = ids(context);
  const { data } = await storageUploadFileOrch({ client: apiClient, path: { workspaceId, orchestrationId }, body: { path: body.path, content_type: body.content_type } });
  return data;
}

export async function getUploadUrlAgent(body: UploadBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId } = ids(context);
  const { data } = await storageUploadFileAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, body: { path: body.path, content_type: body.content_type } });
  return data;
}

export async function getUploadUrlLayer(body: UploadBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  const { data } = await storageUploadFileLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, body: { path: body.path, content_type: body.content_type } });
  return data;
}

// ── Delete file ────────────────────────────────────────────────────────────────

export async function deleteFileWorkspace(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId } = ids(context);
  await storageDeleteFileWorkspace({ client: apiClient, path: { workspaceId }, query: { path: body.path } });
  return { success: true };
}

export async function deleteFileOrchestration(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId } = ids(context);
  await storageDeleteFileOrch({ client: apiClient, path: { workspaceId, orchestrationId }, query: { path: body.path } });
  return { success: true };
}

export async function deleteFileAgent(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId } = ids(context);
  await storageDeleteFileAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, query: { path: body.path } });
  return { success: true };
}

export async function deleteFileLayer(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  await storageDeleteFileLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, query: { path: body.path } });
  return { success: true };
}

// ── Create directory ───────────────────────────────────────────────────────────

export async function createDirWorkspace(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId } = ids(context);
  await storageCreateDirWorkspace({ client: apiClient, path: { workspaceId }, body: { path: body.path } });
  return { success: true };
}

export async function createDirOrchestration(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId } = ids(context);
  await storageCreateDirOrch({ client: apiClient, path: { workspaceId, orchestrationId }, body: { path: body.path } });
  return { success: true };
}

export async function createDirAgent(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId } = ids(context);
  await storageCreateDirAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, body: { path: body.path } });
  return { success: true };
}

export async function createDirLayer(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  await storageCreateDirLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, body: { path: body.path } });
  return { success: true };
}

// ── Delete directory ───────────────────────────────────────────────────────────

export async function deleteDirWorkspace(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId } = ids(context);
  await storageDeleteDirWorkspace({ client: apiClient, path: { workspaceId }, query: { path: body.path } });
  return { success: true };
}

export async function deleteDirOrchestration(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId } = ids(context);
  await storageDeleteDirOrch({ client: apiClient, path: { workspaceId, orchestrationId }, query: { path: body.path } });
  return { success: true };
}

export async function deleteDirAgent(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId } = ids(context);
  await storageDeleteDirAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, query: { path: body.path } });
  return { success: true };
}

export async function deleteDirLayer(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  await storageDeleteDirLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, query: { path: body.path } });
  return { success: true };
}

// ── File metadata ──────────────────────────────────────────────────────────────

export async function getFileMetadataWorkspace(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId } = ids(context);
  const { data } = await storageFileMetadataWorkspace({ client: apiClient, path: { workspaceId }, query: { path: body.path } });
  return data;
}

export async function getFileMetadataOrchestration(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId } = ids(context);
  const { data } = await storageFileMetadataOrch({ client: apiClient, path: { workspaceId, orchestrationId }, query: { path: body.path } });
  return data;
}

export async function getFileMetadataAgent(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId } = ids(context);
  const { data } = await storageFileMetadataAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, query: { path: body.path } });
  return data;
}

export async function getFileMetadataLayer(body: FileBody, context: Context, _e: Client, apiClient: Client) {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  const { data } = await storageFileMetadataLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, query: { path: body.path } });
  return data;
}
