import type { Context, Setting } from "@orchestration-ai/sdk/services";
import type { Client as OaiClient } from "@orchestration-ai/sdk/app-builder";
import {
  storageUploadFileWorkspace, storageUploadFileOrch, storageUploadFileAgent, storageUploadFileLayer,
  storageDownloadFileWorkspace, storageDownloadFileOrch, storageDownloadFileAgent, storageDownloadFileLayer,
} from "@orchestration-ai/sdk/sdk.gen";
import { Client, APIResponseError, isNotionClientError } from "@notionhq/client";
import { putToSignedUrl } from "../oai-files/oai-files.service.ts";
import { loadSettings } from "../oai-files/oai-files.description.ts";
import { NOTION_API_KEY, NOTION_VERSION, MAX_FILE_BYTES } from "./notion.constants.ts";
import { NOTION_TOOL_TABLE } from "./notion.tools.ts";

export type Scope = "layer" | "agent" | "orchestration" | "workspace";

// ── Notion client factory ───────────────────────────────────────────────────

function getNotionToken(settings: Setting[]): string {
  const s = settings.find((s) => s.setting_name === NOTION_API_KEY);
  const token = s && (s.setting_type === "Secret" || s.setting_type === "Text") ? s.text_value : "";
  if (!token) {
    throw new Error(
      `Notion is not configured for this agent. Set the "${NOTION_API_KEY}" secret setting to a Notion integration token.`,
    );
  }
  return token;
}

async function makeClient(context: Context, apiClient: OaiClient): Promise<Client> {
  const settings = await loadSettings(context, apiClient);
  return new Client({ auth: getNotionToken(settings), notionVersion: NOTION_VERSION });
}

// ── Error normalization ───────────────────────────────────────────────────────

function toToolError(e: unknown): never {
  if (isNotionClientError(e)) {
    const status = e instanceof APIResponseError ? e.status : undefined;
    throw new Error(
      `Notion API error [${e.code}${status ? ` ${status}` : ""}]: ${e.message}`,
    );
  }
  throw e;
}

// ── Generic dispatcher ──────────────────────────────────────────────────────

/** Resolve a dotted method path (e.g. "blocks.children.append") to a bound fn on the client. */
function resolveMethod(client: Client, methodPath: string): (args: unknown) => Promise<unknown> {
  const parts = methodPath.split(".");
  // deno-lint-ignore no-explicit-any
  let owner: any = client;
  // deno-lint-ignore no-explicit-any
  let fn: any = client;
  for (const part of parts) {
    owner = fn;
    fn = fn?.[part];
    if (fn === undefined) {
      throw new Error(`Internal error: Notion client has no method "${methodPath}".`);
    }
  }
  if (typeof fn !== "function") {
    throw new Error(`Internal error: Notion client path "${methodPath}" is not callable.`);
  }
  return fn.bind(owner);
}

/**
 * Build a tool handler for a table entry. The agent-supplied `body` is forwarded
 * verbatim as the single arguments object the Notion SDK expects. The SDK
 * silently drops unknown params, so extra fields are harmless.
 */
function makeDispatchTool(methodPath: string) {
  return async (body: Record<string, unknown>, context: Context, _e: OaiClient, apiClient: OaiClient) => {
    const client = await makeClient(context, apiClient);
    const method = resolveMethod(client, methodPath);
    try {
      return await method(body ?? {});
    } catch (e) {
      toToolError(e);
    }
  };
}

// ── OAI storage helpers (signed URLs) ─────────────────────────────────────────

function ids(context: Context) {
  const { workspaceId, orchestrationId, agentId, layerId } = context.identity;
  return { workspaceId, orchestrationId, agentId, layerId };
}

async function getOaiDownloadUrl(scope: Scope, path: string, context: Context, apiClient: OaiClient): Promise<string> {
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

async function getOaiUploadUrl(scope: Scope, path: string, contentType: string, context: Context, apiClient: OaiClient): Promise<{ upload_url: string; max_size_bytes: number }> {
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
  if (!data?.upload_url) throw new Error("Failed to get signed upload URL for OAI file.");
  return { upload_url: data.upload_url, max_size_bytes: data.max_size_bytes ?? MAX_FILE_BYTES };
}

/** Stream bytes from a URL with a hard size cap. */
async function fetchBytes(url: string, headers: Record<string, string>, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Failed to fetch bytes: ${response.status} ${response.statusText}`);

  const contentLength = response.headers.get("content-length");
  if (contentLength && +contentLength > maxBytes) {
    throw new Error(`File size ${contentLength} bytes exceeds limit of ${maxBytes} bytes.`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Unable to read response body.");

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`File exceeds limit of ${maxBytes} bytes. Aborted.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }

  return { bytes, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

// ── Bridge tool: upload an OAI file to Notion ──────────────────────────────────

type UploadOaiFileBody = {
  scope: Scope;
  path: string;
  filename?: string;
  content_type?: string;
};

/**
 * Reads a file from OAI storage and uploads it to Notion as a file upload.
 * Returns the Notion file_upload object (its `id` can be attached to pages,
 * blocks, or "files" properties by passing { type: "file_upload", id } in a
 * subsequent pages_update / blocks_children_append call).
 */
export async function uploadOaiFileToNotion(body: UploadOaiFileBody, context: Context, _e: OaiClient, apiClient: OaiClient) {
  const client = await makeClient(context, apiClient);

  const downloadUrl = await getOaiDownloadUrl(body.scope, body.path, context, apiClient);
  const { bytes, contentType } = await fetchBytes(downloadUrl, {}, MAX_FILE_BYTES);

  const filename = body.filename ?? body.path.split("/").pop() ?? "file";
  const resolvedContentType = body.content_type ?? contentType;

  try {
    const created = await client.fileUploads.create({
      mode: "single_part",
      filename,
      content_type: resolvedContentType,
    });

    const sent = await client.fileUploads.send({
      file_upload_id: created.id,
      file: {
        filename,
        data: new Blob([bytes.buffer as ArrayBuffer], { type: resolvedContentType }),
      },
    });

    return {
      success: true,
      file_upload_id: created.id,
      status: sent.status,
      filename,
      content_type: resolvedContentType,
      size: bytes.byteLength,
      file_upload: sent,
    };
  } catch (e) {
    toToolError(e);
  }
}

// ── Bridge tool: download a Notion file into OAI storage ───────────────────────

type DownloadNotionFileBody = {
  file_url: string;
  scope: Scope;
  path: string;
  content_type?: string;
};

/**
 * Downloads a Notion-hosted (or external) file URL — as found in block/property
 * responses — and saves the bytes into OAI storage at the given scope and path.
 * Notion file URLs are pre-signed and time-limited, so call this soon after
 * retrieving the URL from the API.
 */
export async function downloadNotionFileToOai(body: DownloadNotionFileBody, context: Context, _e: OaiClient, apiClient: OaiClient) {
  const { bytes, contentType } = await fetchBytes(body.file_url, {}, MAX_FILE_BYTES);
  const resolvedContentType = body.content_type ?? contentType;

  const { upload_url, max_size_bytes } = await getOaiUploadUrl(body.scope, body.path, resolvedContentType, context, apiClient);
  await putToSignedUrl(upload_url, bytes, resolvedContentType, max_size_bytes);

  return {
    success: true,
    scope: body.scope,
    path: body.path,
    size: bytes.byteLength,
    content_type: resolvedContentType,
  };
}

// ── Tool map ──────────────────────────────────────────────────────────────────

export type ToolHandler = (
  body: Record<string, unknown>,
  context: Context,
  engineClient: OaiClient,
  apiClient: OaiClient,
) => unknown | Promise<unknown>;

/** Builds the complete tools map: generic dispatch tools + OAI file bridge tools. */
export function buildNotionTools(): Record<string, ToolHandler> {
  const tools: Record<string, ToolHandler> = {};
  for (const entry of NOTION_TOOL_TABLE) {
    tools[entry.tool] = makeDispatchTool(entry.method) as ToolHandler;
  }
  // deno-lint-ignore no-explicit-any
  tools.upload_oai_file_to_notion = uploadOaiFileToNotion as any;
  // deno-lint-ignore no-explicit-any
  tools.download_notion_file_to_oai = downloadNotionFileToOai as any;
  return tools;
}
