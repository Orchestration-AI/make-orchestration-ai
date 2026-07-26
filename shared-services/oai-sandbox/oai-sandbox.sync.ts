import type { Context } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";

// Use a structural interface to avoid npm vs JSR Sandbox type identity mismatch
interface SandboxCommandBuilder {
  noThrow(): SandboxCommandBuilder;
  text(): Promise<string>;
}
interface SandboxLike {
  readonly closed: Promise<void>;
  sh(strings: TemplateStringsArray, ...values: unknown[]): SandboxCommandBuilder;
  fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>): Promise<void>;
    readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
    readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }>;
    stat(path: string): Promise<{ mtime: Date | null }>;
  };
}

// Returns a fresh sandbox connection, or throws if the sandbox has been killed.
// Sentinel used to detect if `closed` has already resolved.
const ALREADY_CLOSED = Symbol("already_closed");
async function isDisconnected(sandbox: SandboxLike): Promise<boolean> {
  const result = await Promise.race([sandbox.closed.then(() => ALREADY_CLOSED), Promise.resolve(null)]);
  return result === ALREADY_CLOSED;
}

export type SandboxReconnectFn = () => Promise<SandboxLike>;
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
    if (reconnect && await isDisconnected(sandbox)) {
      console.log(`[oai-sandbox:sync] Connection lost during downsync, reconnecting...`);
      sandbox = await reconnect();
    }
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

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      console.warn(`[oai-sandbox:sync] Failed to download ${remoteFile}: HTTP ${res.status} - skipping`);
      continue;
    }

    const relativePath = remoteFile.startsWith(mount.remote_path)
      ? remoteFile.slice(mount.remote_path.length).replace(/^\//, "")
      : remoteFile;
    const vmPath = `${mount.local_path}/${relativePath}`;
    const parentDir = vmPath.substring(0, vmPath.lastIndexOf("/"));

    await sandbox.fs.mkdir(parentDir, { recursive: true });
    const bytes = new Uint8Array(await res.arrayBuffer());
    await sandbox.fs.writeFile(vmPath, bytes);

    const storedMode = cached.value?.mode;
    if (storedMode) {
      await sandbox.sh`chmod ${storedMode} ${vmPath}`.noThrow().text();
      console.log(`[oai-sandbox:sync] Restored mode ${storedMode} on VM:${vmPath}`);
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
    await sandbox.fs.stat(mount.local_path);
  } catch {
    console.log(`[oai-sandbox:sync] Mount dir VM:${mount.local_path} does not exist - nothing to upsync`);
    return;
  }

  let synced = 0;
  let skipped = 0;

  async function walkAndUpload(vmDir: string, remoteBase: string): Promise<void> {
    for await (const entry of sandbox.fs.readDir(vmDir)) {
      const vmPath = `${vmDir}/${entry.name}`;
      const remotePath = `${remoteBase}/${entry.name}`;

      if (entry.isDirectory) {
        await walkAndUpload(vmPath, remotePath);
        continue;
      }

      if (reconnect && await isDisconnected(sandbox)) {
        console.log(`[oai-sandbox:sync] Connection lost during upsync, reconnecting...`);
        sandbox = await reconnect();
      }
      const stat = await sandbox.fs.stat(vmPath);
      const localMtime = stat.mtime?.toISOString() ?? "";

      const syncKey = ["sandbox_sync", sessionId, remotePath];
      const cached = await kv.get<SyncState>(syncKey);

      if (cached.value?.lastModified === localMtime && localMtime !== "") {
        skipped++;
        continue;
      }

      const modeRaw = await sandbox.sh`stat -c '%a' ${vmPath}`.noThrow().text();
      const mode = modeRaw.trim() || undefined;

      const contentType = inferContentType(vmPath);
      const uploadData = await getUploadUrl(mount.scope, remotePath, contentType, context, apiClient);
      if (!uploadData?.upload_url) {
        console.warn(`[oai-sandbox:sync] No upload URL for ${remotePath} - skipping`);
        continue;
      }

      const bytes = await sandbox.fs.readFile(vmPath);
      const res = await fetch(uploadData.upload_url, {
        method: "PUT",
        body: bytes.buffer as ArrayBuffer,
        headers: {
          "Content-Type": contentType,
          "x-goog-content-length-range": `0,${uploadData.max_size_bytes ?? 104857600}`,
        },
      });
      if (!res.ok) {
        console.warn(`[oai-sandbox:sync] Failed to upload ${remotePath}: HTTP ${res.status} - skipping`);
        continue;
      }

      console.log(`[oai-sandbox:sync] Upsynced VM:${vmPath} → ${remotePath} (${bytes.length} bytes)`);
      await kv.set(syncKey, { lastModified: localMtime, mode } satisfies SyncState);
      synced++;
    }
  }

  await walkAndUpload(mount.local_path, mount.remote_path);
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
