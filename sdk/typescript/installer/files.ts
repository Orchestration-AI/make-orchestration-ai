// OAI file upload/delete helpers for the installer.
//
// Mirrors the two-step flow used by the Terraform storage_file resource:
//   1. POST to the scoped /storage/files endpoint to obtain a signed GCS URL.
//   2. PUT the bytes directly to GCS with the required content-length-range header.
// Deletion goes through the same scoped endpoint with the path as a query param.

import type { Client } from "../client";
import {
  storageUploadFileOrch,
  storageUploadFileAgent,
  storageDeleteFileOrch,
  storageDeleteFileAgent,
} from "../sdk.gen";
import type { FileDef } from "./define";

const DEFAULT_MAX_SIZE = 104_857_600; // 100 MB, same default as the TF provider.

/** Infer a content type from a file path extension. */
export function inferContentType(path: string, override?: string): string {
  if (override) return override;
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    json: "application/json",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Resolve a FileDef to its bytes + content type. `content` is inline text;
 * `source` is read from disk via a caller-supplied reader (keeps this module
 * runtime-neutral — Node vs Deno — and testable).
 */
export async function resolveFileBytes(
  file: FileDef,
  readSource: (sourcePath: string) => Promise<Uint8Array>
): Promise<{ data: Uint8Array; contentType: string }> {
  if (file.content != null && file.source != null) {
    throw new Error(`file "${file.path}": exactly one of content or source may be set`);
  }
  if (file.content != null) {
    return {
      data: new TextEncoder().encode(file.content),
      contentType: inferContentType(file.path, file.content_type ?? "text/plain"),
    };
  }
  if (file.source != null) {
    return {
      data: await readSource(file.source),
      contentType: inferContentType(file.path, file.content_type),
    };
  }
  throw new Error(`file "${file.path}": one of content or source is required`);
}

type OrchScope = { scope: "orchestration"; workspaceId: string; orchestrationId: string };
type AgentScope = { scope: "agent"; workspaceId: string; orchestrationId: string; agentId: string };
export type StorageScope = OrchScope | AgentScope;

/** Request a signed upload URL for the given scope + destination path. */
async function requestSignedUrl(
  client: Client,
  target: StorageScope,
  path: string,
  contentType: string
): Promise<{ uploadUrl: string; maxSize: number }> {
  if (target.scope === "orchestration") {
    const { data, error } = await storageUploadFileOrch({
      client,
      path: { workspaceId: target.workspaceId, orchestrationId: target.orchestrationId },
      body: { path, content_type: contentType },
    });
    if (error) throw new Error(`signed URL request failed: ${JSON.stringify(error)}`);
    return { uploadUrl: data!.upload_url!, maxSize: data!.max_size_bytes ?? DEFAULT_MAX_SIZE };
  }
  const { data, error } = await storageUploadFileAgent({
    client,
    path: { workspaceId: target.workspaceId, orchestrationId: target.orchestrationId, agentId: target.agentId },
    body: { path, content_type: contentType },
  });
  if (error) throw new Error(`signed URL request failed: ${JSON.stringify(error)}`);
  return { uploadUrl: data!.upload_url!, maxSize: data!.max_size_bytes ?? DEFAULT_MAX_SIZE };
}

/**
 * Upload a single file to OAI storage at the given scope. Returns the stored
 * path so the caller can record it for uninstall.
 */
export async function uploadFile(
  client: Client,
  target: StorageScope,
  file: FileDef,
  readSource: (sourcePath: string) => Promise<Uint8Array>
): Promise<string> {
  const { data, contentType } = await resolveFileBytes(file, readSource);
  const { uploadUrl, maxSize } = await requestSignedUrl(client, target, file.path, contentType);

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-goog-content-length-range": `0,${maxSize}`,
    },
    body: data as unknown as BodyInit,
  });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(`GCS upload failed for "${file.path}" (${put.status}): ${text}`);
  }
  return file.path;
}

/** Delete a single file from OAI storage at the given scope. */
export async function deleteFile(
  client: Client,
  target: StorageScope,
  path: string
): Promise<void> {
  if (target.scope === "orchestration") {
    const { error } = await storageDeleteFileOrch({
      client,
      path: { workspaceId: target.workspaceId, orchestrationId: target.orchestrationId },
      query: { path },
    });
    if (error) throw new Error(`file delete failed for "${path}": ${JSON.stringify(error)}`);
    return;
  }
  const { error } = await storageDeleteFileAgent({
    client,
    path: { workspaceId: target.workspaceId, orchestrationId: target.orchestrationId, agentId: target.agentId },
    query: { path },
  });
  if (error) throw new Error(`file delete failed for "${path}": ${JSON.stringify(error)}`);
}

/**
 * Default source reader for Node/Deno. Reads a local file into bytes. The
 * apply engine passes this unless a caller supplies its own (e.g. for tests or
 * bundled assets).
 */
export async function defaultReadSource(sourcePath: string): Promise<Uint8Array> {
  // Dynamic import keeps the browser bundle clean; installers run server-side.
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(sourcePath);
  return new Uint8Array(buf);
}
