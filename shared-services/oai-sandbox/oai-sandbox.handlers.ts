import { getContext } from "../context.middleware.ts";
import { createApiClient } from "@orchestration-ai/sdk/services";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { authDecryptPasskey, storageDownloadFileAgent, storageUploadFileAgent } from "@orchestration-ai/sdk/sdk.gen";
import { kv, decrementSemaphore, type JobRecord, type SessionRecord } from "./oai-sandbox.queue.ts";
import { Sandbox } from "@deno/sandbox";
import { CONFIG_FILE_PATH } from "./oai-sandbox.constants.ts";
import { getRequiredEnvValue } from "../environment.ts";
// @deno-types="npm:@types/express@5.0.0"
import type { Request, Response } from "express";

import process from "node:process";

function makeApiClient(workspaceOwnerId: string) {
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const clientId = getRequiredEnvValue("OAI_CLIENT_ID");
  const apiClient = createApiClient();
  setupClientCredentials(apiClient, {
    client_secret: accessKey,
    client_id: `${clientId}:${workspaceOwnerId}`,
  });
  return apiClient;
}


// GET /services/oai-sandbox/config/api/init
export async function handleConfigInit(req: Request, res: Response): Promise<void> {
  console.log("[oai-sandbox] Config init request received");
  try {
    const passkey = req.query.passkey as string;
    if (!passkey) { res.status(400).send("Missing passkey"); return; }

    const apiClient = createApiClient();
    const { data: decrypted } = await authDecryptPasskey({ body: { passkey }, client: apiClient });
    const layerId = decrypted?.data as string;
    if (!layerId) {
      console.warn("[oai-sandbox] Config init: invalid passkey");
      res.status(401).send("Invalid passkey");
      return;
    }

    const context = await getContext(layerId);
    console.log(`[oai-sandbox] Config init authenticated for agent ${context.identity.agentId}`);
    const authedClient = makeApiClient(context.identity.workspaceOwnerId);

    let pairs: { key: string; value: string }[] = [];
    try {
      const { data } = await storageDownloadFileAgent({
        client: authedClient,
        path: { workspaceId: context.identity.workspaceId, orchestrationId: context.identity.orchestrationId, agentId: context.identity.agentId },
        query: { path: CONFIG_FILE_PATH },
      });
      const downloadUrl = (data as { download_url?: string })?.download_url;
      if (downloadUrl) {
        const fileRes = await fetch(downloadUrl);
        if (fileRes.ok) {
          pairs = await fileRes.json();
          console.log(`[oai-sandbox] Loaded ${pairs.length} existing env var config pair(s) for agent ${context.identity.agentId}`);
        }
      } else {
        console.log(`[oai-sandbox] No existing env var config for agent ${context.identity.agentId}`);
      }
    } catch {
      console.log(`[oai-sandbox] No existing env var config found for agent ${context.identity.agentId} - starting fresh`);
    }

    res.json({ pairs, layerId: context.identity.layerId });
  } catch (err) {
    console.warn("[oai-sandbox] Config init error:", err);
    res.status(500).send("Init failed");
  }
}

// POST /services/oai-sandbox/config/api/save
export async function handleConfigSave(req: Request, res: Response): Promise<void> {
  console.log("[oai-sandbox] Config save request received");
  try {
    const layerId = req.headers["x-layer-id"] as string;
    if (!layerId) { res.status(401).send("Missing x-layer-id header"); return; }

    const context = await getContext(layerId);
    console.log(`[oai-sandbox] Config save authenticated for agent ${context.identity.agentId}`);
    const authedClient = makeApiClient(context.identity.workspaceOwnerId);

    const { pairs } = req.body as { pairs: { key: string; value: string }[] };
    console.log(`[oai-sandbox] Saving ${pairs?.length ?? 0} env var config pair(s) for agent ${context.identity.agentId}`);

    const content = JSON.stringify(pairs ?? []);
    const bytes = new TextEncoder().encode(content);

    const { data } = await storageUploadFileAgent({
      client: authedClient,
      path: { workspaceId: context.identity.workspaceId, orchestrationId: context.identity.orchestrationId, agentId: context.identity.agentId },
      body: { path: CONFIG_FILE_PATH, content_type: "application/json" },
    });

    if (!data?.upload_url) throw new Error("Failed to get upload URL");

    const uploadRes = await fetch(data.upload_url, {
      method: "PUT",
      body: bytes.buffer as ArrayBuffer,
      headers: {
        "Content-Type": "application/json",
        "x-goog-content-length-range": `0,${data.max_size_bytes ?? 104857600}`,
      },
    });
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

    console.log(`[oai-sandbox] Env var config saved successfully for agent ${context.identity.agentId}`);
    res.status(200).send("ok");
  } catch (err) {
    console.warn("[oai-sandbox] Config save error:", err);
    res.status(500).send(`${err}`);
  }
}

// GET /services/oai-sandbox/config/api/jobs
export async function handleJobsList(req: Request, res: Response): Promise<void> {
  const layerId = req.headers["x-layer-id"] as string;
  if (!layerId) { res.status(401).send("Missing x-layer-id header"); return; }

  try {
    const context = await getContext(layerId);
    const agentId = context.identity.agentId;

    const jobs: { jobId: string; sessionId: string; status: string; enqueuedAt: number; startedAt?: number }[] = [];
    const iter = kv.list<JobRecord>({ prefix: ["sandbox_job"] });
    for await (const entry of iter) {
      const job = entry.value;
      const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", job.sessionId]);
      if (sessionEntry.value?.identity.agentId !== agentId) continue;
      jobs.push({ jobId: entry.key[1] as string, sessionId: job.sessionId, status: job.status, enqueuedAt: job.enqueuedAt, startedAt: job.startedAt });
    }

    res.json({ jobs });
  } catch (err) {
    console.error("[oai-sandbox] handleJobsList error:", err);
    res.status(500).send(`${err}`);
  }
}

// POST /services/oai-sandbox/config/api/jobs/:jobId/cancel
export async function handleJobCancel(req: Request, res: Response): Promise<void> {
  const layerId = req.headers["x-layer-id"] as string;
  if (!layerId) { res.status(401).send("Missing x-layer-id header"); return; }

  try {
    const context = await getContext(layerId);
    const { jobId } = req.params;

    const entry = await kv.get<JobRecord>(["sandbox_job", jobId]);
    if (!entry.value) { res.status(404).send("Job not found"); return; }
    if (entry.value.status !== "pending") { res.status(400).send("Only pending jobs can be cancelled"); return; }

    const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", entry.value.sessionId]);
    if (sessionEntry.value?.identity.agentId !== context.identity.agentId) { res.status(403).send("Forbidden"); return; }

    await kv.delete(["sandbox_job", jobId]);
    console.log(`[oai-sandbox] Job ${jobId} cancelled by user (no ticker sent)`);
    res.json({ success: true });
  } catch (err) {
    console.error("[oai-sandbox] handleJobCancel error:", err);
    res.status(500).send(`${err}`);
  }
}

// GET /services/oai-sandbox/config/api/jobs/:jobId/output
export async function handleJobOutput(req: Request, res: Response): Promise<void> {
  const layerId = req.headers["x-layer-id"] as string;
  if (!layerId) { res.status(401).send("Missing x-layer-id header"); return; }

  try {
    const context = await getContext(layerId);
    const { jobId } = req.params;

    const entry = await kv.get<JobRecord>(["sandbox_job", jobId]);
    if (!entry.value) { res.status(404).send("Job not found"); return; }
    if (entry.value.status !== "running") { res.status(400).send("Job is not running"); return; }
    if (!entry.value.sandboxId) { res.status(400).send("No sandbox attached yet"); return; }

    const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", entry.value.sessionId]);
    if (sessionEntry.value?.identity.agentId !== context.identity.agentId) { res.status(403).send("Forbidden"); return; }

    const sandbox = await Sandbox.connect(entry.value.sandboxId);
    const [stdout, stderr] = await Promise.all([
      sandbox.sh`cat /proc/1/fd/1 2>/dev/null || journalctl -n 200 --no-pager 2>/dev/null || echo "(no output)"`.noThrow().text(),
      sandbox.sh`cat /proc/1/fd/2 2>/dev/null || echo "(no stderr)"`.noThrow().text(),
    ]);
    await sandbox.close();

    res.json({ stdout, stderr });
  } catch (err) {
    console.error("[oai-sandbox] handleJobOutput error:", err);
    res.status(500).send(`${err}`);
  }
}

// POST /services/oai-sandbox/config/api/jobs/:jobId/stop
export async function handleJobStop(req: Request, res: Response): Promise<void> {
  const layerId = req.headers["x-layer-id"] as string;
  if (!layerId) { res.status(401).send("Missing x-layer-id header"); return; }

  try {
    const context = await getContext(layerId);
    const { jobId } = req.params;

    const entry = await kv.get<JobRecord>(["sandbox_job", jobId]);
    if (!entry.value) { res.status(404).send("Job not found"); return; }
    if (entry.value.status !== "running") { res.status(400).send("Job is not running"); return; }
    if (!entry.value.sandboxId) { res.status(400).send("No sandbox attached yet"); return; }

    const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", entry.value.sessionId]);
    if (sessionEntry.value?.identity.agentId !== context.identity.agentId) { res.status(403).send("Forbidden"); return; }

    try {
      const sandbox = await Sandbox.connect(entry.value.sandboxId);
      await sandbox.kill();
    } catch (err) {
      console.warn(`[oai-sandbox] Could not connect to sandbox ${entry.value.sandboxId} during stop (may already be gone):`, err);
    }
    await kv.delete(["sandbox_job", jobId]);
    await decrementSemaphore();
    console.log(`[oai-sandbox] Job ${jobId} force-stopped by user (no ticker sent)`);
    res.json({ success: true });
  } catch (err) {
    console.error("[oai-sandbox] handleJobStop error:", err);
    res.status(500).send(`${err}`);
  }
}

// POST /services/oai-sandbox/internal/reset-counter
export async function handleResetCounter(req: Request, res: Response): Promise<void> {
  const adminKey = process.env.SANDBOX_ADMIN_KEY;
  if (!adminKey) { res.status(503).send("SANDBOX_ADMIN_KEY not configured"); return; }
  if (req.headers["x-admin-key"] !== adminKey) { res.status(401).send("Unauthorized"); return; }

  const entry = await kv.get<number>(["sandbox_running_count"]);
  const previous = entry.value ?? 0;
  await kv.set(["sandbox_running_count"], 0);
  console.warn(`[oai-sandbox] Concurrency counter manually reset from ${previous} to 0`);
  res.json({ previous, current: 0 });
}
