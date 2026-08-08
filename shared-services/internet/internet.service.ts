import type { Context, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import {
  storageUploadFileWorkspace, storageUploadFileOrch, storageUploadFileAgent, storageUploadFileLayer,
  storageDownloadFileWorkspace, storageDownloadFileOrch, storageDownloadFileAgent, storageDownloadFileLayer,
} from "@orchestration-ai/sdk/sdk.gen";
import { putToSignedUrl } from "../oai-files/oai-files.service.ts";
import { boolSetting, loadSettings } from "../oai-files/oai-files.description.ts";
import {
  WORKSPACE_WRITE_KEY, ORCHESTRATION_WRITE_KEY,
  WORKSPACE_READ_KEY, ORCHESTRATION_READ_KEY,
} from "../oai-files/oai-files.constants.ts";
import { MAX_RESPONSE_BYTES, MAX_DOWNLOAD_BYTES } from "./internet.constants.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Scope = "layer" | "agent" | "orchestration" | "workspace";

type RequestBody = {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
};

type DownloadToFileBody = {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  scope: Scope;
  path: string;
};

type RequestWithFileBody = {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  scope: Scope;
  path: string;
  content_type?: string;
};

function ids(context: Context) {
  const { workspaceId, orchestrationId, agentId, layerId } = context.identity;
  return { workspaceId, orchestrationId, agentId, layerId };
}

// ── Shared: stream bytes from a URL with a size cap ───────────────────────────

async function fetchBytes(url: string, method: HttpMethod, headers: Record<string, string>, body: string | undefined, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string; status: number }> {
  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  const contentLength = response.headers.get("content-length");
  if (contentLength && +contentLength > maxBytes) {
    throw new Error(`Response size ${contentLength} bytes exceeds limit of ${maxBytes} bytes.`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Unable to read response body.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds limit of ${maxBytes} bytes. Aborted.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }

  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    status: response.status,
  };
}

// ── Shared: get signed download URL for a scoped OAI file ─────────────────────

async function getOaiDownloadUrl(scope: Scope, path: string, context: Context, apiClient: Client): Promise<string> {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  let data;
  if (scope === "workspace") {
    ({ data } = await storageDownloadFileWorkspace({ client: apiClient, path: { workspaceId }, query: { path } }));
  } else if (scope === "orchestration") {
    ({ data } = await storageDownloadFileOrch({ client: apiClient, path: { workspaceId, orchestrationId }, query: { path } }));
  } else if (scope === "agent") {
    ({ data } = await storageDownloadFileAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, query: { path } }));
  } else {
    ({ data } = await storageDownloadFileLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, query: { path } }));
  }
  const typed = data as { download_url?: string } | undefined;
  if (!typed?.download_url) throw new Error("Failed to get signed download URL for OAI file.");
  return typed.download_url;
}

// ── Shared: get signed upload URL for a scoped OAI file ───────────────────────

async function getOaiUploadUrl(scope: Scope, path: string, contentType: string, context: Context, apiClient: Client): Promise<{ upload_url: string; max_size_bytes: number }> {
  const { workspaceId, orchestrationId, agentId, layerId } = ids(context);
  let data;
  if (scope === "workspace") {
    ({ data } = await storageUploadFileWorkspace({ client: apiClient, path: { workspaceId }, body: { path, content_type: contentType } }));
  } else if (scope === "orchestration") {
    ({ data } = await storageUploadFileOrch({ client: apiClient, path: { workspaceId, orchestrationId }, body: { path, content_type: contentType } }));
  } else if (scope === "agent") {
    ({ data } = await storageUploadFileAgent({ client: apiClient, path: { workspaceId, orchestrationId, agentId }, body: { path, content_type: contentType } }));
  } else {
    ({ data } = await storageUploadFileLayer({ client: apiClient, path: { workspaceId, orchestrationId, agentId, layerId }, body: { path, content_type: contentType } }));
  }
  if (!data?.upload_url) throw new Error("Failed to get signed upload URL.");
  return { upload_url: data.upload_url, max_size_bytes: data.max_size_bytes ?? MAX_DOWNLOAD_BYTES };
}

// ── Scope permission guards ────────────────────────────────────────────────────

function assertWritePermission(scope: Scope, settings: Setting[]) {
  if (scope === "workspace" && !boolSetting(settings, WORKSPACE_WRITE_KEY)) {
    throw new Error("Workspace write access is not enabled for this agent.");
  }
  if (scope === "orchestration" && !boolSetting(settings, ORCHESTRATION_WRITE_KEY)) {
    throw new Error("Orchestration write access is not enabled for this agent.");
  }
}

function assertReadPermission(scope: Scope, settings: Setting[]) {
  if (scope === "workspace" && !boolSetting(settings, WORKSPACE_READ_KEY)) {
    throw new Error("Workspace read access is not enabled for this agent.");
  }
  if (scope === "orchestration" && !boolSetting(settings, ORCHESTRATION_READ_KEY)) {
    throw new Error("Orchestration read access is not enabled for this agent.");
  }
}

// ── Tool: request ──────────────────────────────────────────────────────────────

export async function request(body: RequestBody): Promise<{ status: number; body: string }> {
  const method = body.method ?? "GET";
  const response = await fetch(body.url, {
    method,
    headers: body.headers,
    ...(body.body !== undefined ? { body: body.body } : {}),
  });

  const contentLength = response.headers.get("content-length");
  if (contentLength && +contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response size ${contentLength} bytes exceeds limit of ${MAX_RESPONSE_BYTES} bytes. Use download_to_file for large responses.`);
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response exceeds limit of ${MAX_RESPONSE_BYTES} bytes. Use download_to_file for large responses.`);
  }

  return { status: response.status, body: text };
}

// ── Tool: download_to_file ─────────────────────────────────────────────────────

export async function downloadToFile(body: DownloadToFileBody, context: Context, _e: Client, apiClient: Client): Promise<{ success: true; path: string; size: number; content_type: string }> {
  const settings = await loadSettings(context, apiClient);
  assertWritePermission(body.scope, settings);

  const { bytes, contentType } = await fetchBytes(
    body.url,
    body.method ?? "GET",
    body.headers ?? {},
    body.body,
    MAX_DOWNLOAD_BYTES,
  );

  const { upload_url, max_size_bytes } = await getOaiUploadUrl(body.scope, body.path, contentType, context, apiClient);
  await putToSignedUrl(upload_url, bytes, contentType, max_size_bytes);

  return { success: true, path: body.path, size: bytes.byteLength, content_type: contentType };
}

// ── Tool: request_with_file_body ───────────────────────────────────────────────

export async function requestWithFileBody(body: RequestWithFileBody, context: Context, _e: Client, apiClient: Client): Promise<{ status: number; body: string }> {
  const settings = await loadSettings(context, apiClient);
  assertReadPermission(body.scope, settings);

  const downloadUrl = await getOaiDownloadUrl(body.scope, body.path, context, apiClient);
  const { bytes, contentType } = await fetchBytes(downloadUrl, "GET", {}, undefined, MAX_DOWNLOAD_BYTES);

  const response = await fetch(body.url, {
    method: body.method,
    headers: {
      "Content-Type": body.content_type ?? contentType,
      ...body.headers,
    },
    body: bytes.buffer as ArrayBuffer,
  });

  const contentLength = response.headers.get("content-length");
  if (contentLength && +contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response size ${contentLength} bytes exceeds limit of ${MAX_RESPONSE_BYTES} bytes.`);
  }

  const text = await response.text();
  return { status: response.status, body: text };
}
