import type { Context } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";

// Use a structural interface to avoid npm vs JSR Sandbox type identity mismatch
interface SandboxCommandBuilder {
  signal(s: AbortSignal): SandboxCommandBuilder;
  noThrow(): SandboxCommandBuilder;
  text(): Promise<string>;
}
interface SandboxFs {
  mkdir(path: string, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>;
  writeFile(path: string, data: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>, options?: { signal?: AbortSignal }): Promise<void>;
  readFile(path: string, options?: { signal?: AbortSignal }): Promise<Uint8Array<ArrayBuffer>>;
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }>;
  stat(path: string, options?: { signal?: AbortSignal }): Promise<{ mtime: Date | null; mode: number }>;
  walk(path: string): AsyncIterableIterator<{ path: string; name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }>;
}
interface SandboxLike {
  readonly closed: Promise<void>;
  sh(strings: TemplateStringsArray, ...values: unknown[]): SandboxCommandBuilder;
  fs: SandboxFs;
}

// Returns a fresh sandbox connection, or throws if the sandbox has been killed.
// Sentinel used to detect if `closed` has already resolved.
const ALREADY_CLOSED = Symbol("already_closed");
async function isDisconnected(sandbox: SandboxLike): Promise<boolean> {
  const result = await Promise.race([sandbox.closed.then(() => ALREADY_CLOSED), Promise.resolve(null)]);
  return result === ALREADY_CLOSED;
}

export type SandboxReconnectFn = () => Promise<SandboxLike>;

// Timeout constants (ms)
const OP_TIMEOUT_MS = 30_000;  // per sandbox RPC op (mkdir, writeFile, readFile, stat)
const FETCH_TIMEOUT_MS = 60_000*2; // per HTTP fetch (download/upload)
const RECONNECT_TIMEOUT_MS = 20_000; // Sandbox.connect timeout

// Wraps a promise with a timeout and begin/end logs. Throws if the timeout fires first.
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  console.log(`[oai-sandbox:sync] ${label} started (timeout: ${ms}ms)`);
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
      ),
    ]);
    console.log(`[oai-sandbox:sync] ${label} done`);
    return result;
  } catch (err) {
    console.error(`[oai-sandbox:sync] ${label} failed: ${err}`);
    throw err;
  }
}

// Ensures sandbox is connected, reconnecting if disconnected but not killed.
// Throws if reconnect itself times out or sandbox is killed.
async function ensureConnected(sandbox: SandboxLike, reconnect?: SandboxReconnectFn, label?: string): Promise<SandboxLike> {
  if (!reconnect || !await isDisconnected(sandbox)) return sandbox;
  console.log(`[oai-sandbox:sync] Connection lost${label ? ` (${label})` : ""}, reconnecting...`);
  return await withTimeout(reconnect(), RECONNECT_TIMEOUT_MS, "reconnect");
}

import {
  storageListDirAgent, storageListDirOrch, storageListDirWorkspace,
  storageFileMetadataAgent, storageFileMetadataOrch, storageFileMetadataWorkspace,
  storageDownloadFileAgent, storageDownloadFileOrch, storageDownloadFileWorkspace,
  storageUploadFileAgent, storageUploadFileOrch, storageUploadFileWorkspace,
} from "@orchestration-ai/sdk/sdk.gen";

export type MountScope = "agent" | "orchestration" | "workspace";

export type MountConfig = {
  scope: MountScope;
  remote_path: string;
  local_path: string;
};

type StorageEntry = { name: string; type: "file" | "directory" };
type StorageListResponse = { entries?: StorageEntry[]; total?: number };

type SyncState = { lastModified: string; mode?: string };

const kv = await Deno.openKv();

function inferContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", html: "text/html", css: "text/css",
    js: "text/javascript", ts: "text/typescript", json: "application/json",
    xml: "application/xml", yaml: "application/yaml", yml: "application/yaml",
    sh: "application/x-sh", py: "text/x-python", rb: "text/x-ruby",
    go: "text/x-go", rs: "text/x-rust", java: "text/x-java",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    svg: "image/svg+xml", pdf: "application/pdf", zip: "application/zip",
    gz: "application/gzip", tar: "application/x-tar",
    csv: "text/csv", tsv: "text/tab-separated-values",
  };
  return map[ext] ?? "application/octet-stream";
}

function ids(context: Context) {
  return {
    workspaceId: context.identity.workspaceId,
    orchestrationId: context.identity.orchestrationId,
    agentId: context.identity.agentId,
  };
}

async function listDir(scope: MountScope, path: string, context: Context, apiClient: Client): Promise<StorageListResponse> {
  const p = ids(context);
  if (scope === "agent") {
    const { data } = await storageListDirAgent({ client: apiClient, path: p, query: { path } });
    return data as StorageListResponse;
  }
  if (scope === "orchestration") {
    const { data } = await storageListDirOrch({ client: apiClient, path: { workspaceId: p.workspaceId, orchestrationId: p.orchestrationId }, query: { path } });
    return data as StorageListResponse;
  }
  const { data } = await storageListDirWorkspace({ client: apiClient, path: { workspaceId: p.workspaceId }, query: { path } });
  return data as StorageListResponse;
}

async function getMetadata(scope: MountScope, filePath: string, context: Context, apiClient: Client): Promise<{ updated_at?: string } | undefined> {
  const p = ids(context);
  try {
    if (scope === "agent") {
      const { data } = await storageFileMetadataAgent({ client: apiClient, path: p, query: { path: filePath } });
      return data as { updated_at?: string };
    }
    if (scope === "orchestration") {
      const { data } = await storageFileMetadataOrch({ client: apiClient, path: { workspaceId: p.workspaceId, orchestrationId: p.orchestrationId }, query: { path: filePath } });
      return data as { updated_at?: string };
    }
    const { data } = await storageFileMetadataWorkspace({ client: apiClient, path: { workspaceId: p.workspaceId }, query: { path: filePath } });
    return data as { updated_at?: string };
  } catch {
    return undefined;
  }
}

async function getDownloadUrl(scope: MountScope, filePath: string, context: Context, apiClient: Client): Promise<string | undefined> {
  const p = ids(context);
  if (scope === "agent") {
    const { data } = await storageDownloadFileAgent({ client: apiClient, path: p, query: { path: filePath } });
    return (data as { download_url?: string })?.download_url;
  }
  if (scope === "orchestration") {
    const { data } = await storageDownloadFileOrch({ client: apiClient, path: { workspaceId: p.workspaceId, orchestrationId: p.orchestrationId }, query: { path: filePath } });
    return (data as { download_url?: string })?.download_url;
  }
  const { data } = await storageDownloadFileWorkspace({ client: apiClient, path: { workspaceId: p.workspaceId }, query: { path: filePath } });
  return (data as { download_url?: string })?.download_url;
}

async function getUploadUrl(scope: MountScope, filePath: string, contentType: string, context: Context, apiClient: Client): Promise<{ upload_url?: string; max_size_bytes?: number } | undefined> {
  const p = ids(context);
  if (scope === "agent") {
    const { data } = await storageUploadFileAgent({ client: apiClient, path: p, body: { path: filePath, content_type: contentType } });
    return data;
  }
  if (scope === "orchestration") {
    const { data } = await storageUploadFileOrch({ client: apiClient, path: { workspaceId: p.workspaceId, orchestrationId: p.orchestrationId }, body: { path: filePath, content_type: contentType } });
    return data;
  }
  const { data } = await storageUploadFileWorkspace({ client: apiClient, path: { workspaceId: p.workspaceId }, body: { path: filePath, content_type: contentType } });
  return data;
}

async function collectRemoteFiles(scope: MountScope, dirPath: string, context: Context, apiClient: Client): Promise<string[]> {
  const result = await listDir(scope, dirPath, context, apiClient);
  const entries = result?.entries ?? [];
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = dirPath ? `${dirPath}/${entry.name.replace(/\/$/, "")}` : entry.name.replace(/\/$/, "");
    if (entry.type === "directory") {
      files.push(...await collectRemoteFiles(scope, fullPath, context, apiClient));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export async function downsync(sessionId: string, mount: MountConfig, sandbox: SandboxLike, context: Context, apiClient: Client, reconnect?: SandboxReconnectFn): Promise<void> {
  console.log(`[oai-sandbox:sync] Downsync started for session ${sessionId}: ${mount.scope}:${mount.remote_path} → VM:${mount.local_path}`);

  const remoteFiles = await collectRemoteFiles(mount.scope, mount.remote_path, context, apiClient);
  console.log(`[oai-sandbox:sync] Found ${remoteFiles.length} remote file(s) to evaluate for downsync`);

  let synced = 0;
  let skipped = 0;

  for (const remoteFile of remoteFiles) {
    sandbox = await ensureConnected(sandbox, reconnect, `downsync ${remoteFile}`);

    const meta = await getMetadata(mount.scope, remoteFile, context, apiClient);
    const remoteLastModified = meta?.updated_at ?? "";

    const syncKey = ["sandbox_sync", sessionId, remoteFile];
    const cached = await kv.get<SyncState>(syncKey);

    if (cached.value?.lastModified === remoteLastModified && remoteLastModified !== "") {
      skipped++;
      continue;
    }

    const downloadUrl = await getDownloadUrl(mount.scope, remoteFile, context, apiClient);
    if (!downloadUrl) {
      console.warn(`[oai-sandbox:sync] No download URL for ${remoteFile} - skipping`);
      continue;
    }

    const res = await withTimeout(
      fetch(downloadUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      FETCH_TIMEOUT_MS,
      `download ${remoteFile}`
    );
    if (!res.ok) {
      console.warn(`[oai-sandbox:sync] Failed to download ${remoteFile}: HTTP ${res.status} - skipping`);
      continue;
    }

    const relativePath = remoteFile.startsWith(mount.remote_path)
      ? remoteFile.slice(mount.remote_path.length).replace(/^\//, "")
      : remoteFile;
    const vmPath = `${mount.local_path}/${relativePath}`;
    const parentDir = vmPath.substring(0, vmPath.lastIndexOf("/"));

    const opSignal = AbortSignal.timeout(OP_TIMEOUT_MS);
    await withTimeout(sandbox.fs.mkdir(parentDir, { recursive: true }), OP_TIMEOUT_MS, `mkdir ${parentDir}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await withTimeout(sandbox.fs.writeFile(vmPath, bytes, { signal: opSignal }), OP_TIMEOUT_MS, `writeFile ${vmPath}`);

    const storedMode = cached.value?.mode;
    if (storedMode) {
      const chmodSignal = AbortSignal.timeout(OP_TIMEOUT_MS);
      await sandbox.sh(Object.assign([`chmod ${storedMode} ${vmPath}`], { raw: [`chmod ${storedMode} ${vmPath}`] })).signal(chmodSignal).text()
        .then(() => console.log(`[oai-sandbox:sync] Restored mode ${storedMode} on VM:${vmPath}`))
        .catch((err) => console.warn(`[oai-sandbox:sync] Failed to restore mode ${storedMode} on VM:${vmPath}: ${err}`));
    }
    console.log(`[oai-sandbox:sync] Downsynced ${remoteFile} → VM:${vmPath} (${bytes.length} bytes)`);

    await kv.set(syncKey, { lastModified: remoteLastModified, mode: storedMode } satisfies SyncState);
    synced++;
  }

  console.log(`[oai-sandbox:sync] Downsync complete for session ${sessionId}: ${synced} synced, ${skipped} skipped (up to date)`);
}

export async function upsync(sessionId: string, mount: MountConfig, sandbox: SandboxLike, context: Context, apiClient: Client, reconnect?: SandboxReconnectFn): Promise<void> {
  console.log(`[oai-sandbox:sync] Upsync started for session ${sessionId}: VM:${mount.local_path} → ${mount.scope}:${mount.remote_path}`);

  try {
    await withTimeout(sandbox.fs.stat(mount.local_path), OP_TIMEOUT_MS, `stat ${mount.local_path}`);
  } catch {
    console.log(`[oai-sandbox:sync] Mount dir VM:${mount.local_path} does not exist - nothing to upsync`);
    return;
  }

  let synced = 0;
  let skipped = 0;

  // Use fs.walk for a single streaming RPC instead of recursive readDir calls.
  // Each iteration yields a file entry with its full path.
  for await (const entry of sandbox.fs.walk(mount.local_path)) {
    if (!entry.isFile) continue;

    const vmPath = entry.path;
    const relativePath = vmPath.startsWith(mount.local_path)
      ? vmPath.slice(mount.local_path.length).replace(/^\//, "")
      : vmPath;
    const remotePath = `${mount.remote_path}/${relativePath}`;

    sandbox = await ensureConnected(sandbox, reconnect, `upsync ${vmPath}`);

    const stat = await withTimeout(sandbox.fs.stat(vmPath), OP_TIMEOUT_MS, `stat ${vmPath}`);
    const localMtime = stat.mtime?.toISOString() ?? "";

    const syncKey = ["sandbox_sync", sessionId, remotePath];
    const cached = await kv.get<SyncState>(syncKey);

    if (cached.value?.lastModified === localMtime && localMtime !== "") {
      skipped++;
      continue;
    }

    // Extract mode from stat.mode bitmask — avoids a separate sh`stat` RPC call
    const mode = stat.mode ? (stat.mode & 0o777).toString(8) : undefined;

    const contentType = inferContentType(vmPath);
    const uploadData = await getUploadUrl(mount.scope, remotePath, contentType, context, apiClient);
    if (!uploadData?.upload_url) {
      console.warn(`[oai-sandbox:sync] No upload URL for ${remotePath} - skipping`);
      continue;
    }

    const bytes = await withTimeout(sandbox.fs.readFile(vmPath, { signal: AbortSignal.timeout(OP_TIMEOUT_MS) }), OP_TIMEOUT_MS, `readFile ${vmPath}`);
    const res = await withTimeout(
      fetch(uploadData.upload_url, {
        method: "PUT",
        body: bytes.buffer as ArrayBuffer,
        headers: {
          "Content-Type": contentType,
          "x-goog-content-length-range": `0,${uploadData.max_size_bytes ?? 104857600}`,
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
      FETCH_TIMEOUT_MS,
      `upload ${remotePath}`
    );
    if (!res.ok) {
      console.warn(`[oai-sandbox:sync] Failed to upload ${remotePath}: HTTP ${res.status} - skipping`);
      continue;
    }

    console.log(`[oai-sandbox:sync] Upsynced VM:${vmPath} → ${remotePath} (${bytes.length} bytes)`);
    await kv.set(syncKey, { lastModified: localMtime, mode } satisfies SyncState);
    synced++;
  }

  console.log(`[oai-sandbox:sync] Upsync complete for session ${sessionId}: ${synced} synced, ${skipped} skipped (up to date)`);
}

export async function deleteSyncState(sessionId: string): Promise<void> {
  console.log(`[oai-sandbox:sync] Deleting sync state for session ${sessionId}`);
  let count = 0;
  const iter = kv.list<SyncState>({ prefix: ["sandbox_sync", sessionId] });
  for await (const entry of iter) {
    await kv.delete(entry.key);
    count++;
  }
  console.log(`[oai-sandbox:sync] Deleted ${count} sync state entries for session ${sessionId}`);
}
