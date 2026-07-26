import { getContext } from "../context.middleware.ts";
import { createApiClient } from "@orchestration-ai/sdk/services";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { authDecryptPasskey, storageDownloadFileAgent, storageUploadFileAgent } from "@orchestration-ai/sdk/sdk.gen";
import { finalizeJob, kv } from "./oai-sandbox.queue.ts";
import { CONFIG_FILE_PATH } from "./oai-sandbox.constants.ts";
import { getRequiredEnvValue } from "../environment.ts";
// @deno-types="npm:@types/express@5.0.0"
import type { Request, Response } from "express";

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

// POST /services/oai-sandbox/api/job-done/:layerId/:jobId
export async function handleJobDone(req: Request, res: Response): Promise<void> {
  const { layerId, jobId } = req.params;
  console.log(`[oai-sandbox] Webhook received: job-done for job ${jobId} (layerId: ${layerId})`);
  try {
    const { exit_code } = req.body as { exit_code: number };
    console.log(`[oai-sandbox] Job ${jobId} reported exit code: ${exit_code}`);

    const context = await getContext(layerId);
    const jobEntry = await kv.get<{ sessionId: string }>(["sandbox_job", jobId]);
    if (!jobEntry.value) {
      console.warn(`[oai-sandbox] Job ${jobId} not found in KV — may have already been finalized`);
      res.status(404).send("Job not found");
      return;
    }

    console.log(`[oai-sandbox] Finalizing job ${jobId} for session ${jobEntry.value.sessionId}`);
    await finalizeJob(jobId, jobEntry.value.sessionId, exit_code ?? -1);
    res.status(200).send("ok");
  } catch (err) {
    console.error(`[oai-sandbox] job-done webhook error for job ${jobId}:`, err);
    res.status(500).send(`${err}`);
  }
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
      console.log(`[oai-sandbox] No existing env var config found for agent ${context.identity.agentId} — starting fresh`);
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
