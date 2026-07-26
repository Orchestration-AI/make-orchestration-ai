import { createApiClient } from "@orchestration-ai/sdk/services";
import { taskCreate, storageDownloadFileAgent, settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { downsync, upsync } from "./oai-sandbox.sync.ts";
import { CONFIG_FILE_PATH, SANDBOX_REGION } from "./oai-sandbox.constants.ts";
import process from "node:process";

import { Sandbox, type SandboxOptions } from "@deno/sandbox";
import type { MountConfig } from "./oai-sandbox.sync.ts";

export type JobRecord = {
  sessionId: string;
  sandboxId?: string;
  status: "pending" | "running" | "done" | "failed" | "orphaned";
  enqueuedAt: number;
  startedAt?: number;
  command?: string;
};

export type SessionRecord = {
  layerId: string;
  identity: {
    workspaceId: string;
    orchestrationId: string;
    agentId: string;
    workspaceOwnerId: string;
  };
  mount?: MountConfig;
  volumeId?: string;
  lastJobAt: number;
  agentSessionId?: string;
};

const kv = await Deno.openKv();

const MAX_CONCURRENT = parseInt(Deno.env.get("SANDBOX_MAX_CONCURRENT") ?? "2");
const SANDBOX_TIMEOUT_SECS = "30m" as const;

function makeApiClient(identity: SessionRecord["identity"]) {
  const accessKey = process.env.OAI_ACCESS_KEY!;
  const clientId = process.env.OAI_CLIENT_ID!;
  const apiClient = createApiClient();
  setupClientCredentials(apiClient, {
    client_secret: accessKey,
    client_id: `${clientId}:${identity.workspaceOwnerId}`,
  });
  return apiClient;
}

async function getSemaphore(): Promise<number> {
  const entry = await kv.get<number>(["sandbox_running_count"]);
  return entry.value ?? 0;
}

async function incrementSemaphore(): Promise<void> {
  while (true) {
    const entry = await kv.get<number>(["sandbox_running_count"]);
    const current = entry.value ?? 0;
    const res = await kv.atomic()
      .check(entry)
      .set(["sandbox_running_count"], current + 1)
      .commit();
    if (res.ok) {
      console.log(`[oai-sandbox] Semaphore incremented to ${current + 1}/${MAX_CONCURRENT}`);
      return;
    }
  }
}

async function decrementSemaphore(): Promise<void> {
  while (true) {
    const entry = await kv.get<number>(["sandbox_running_count"]);
    const current = entry.value ?? 0;
    const next = Math.max(0, current - 1);
    const res = await kv.atomic()
      .check(entry)
      .set(["sandbox_running_count"], next)
      .commit();
    if (res.ok) {
      console.log(`[oai-sandbox] Semaphore decremented to ${next}/${MAX_CONCURRENT}`);
      return;
    }
  }
}

async function loadEnvVars(identity: SessionRecord["identity"]): Promise<Record<string, string>> {
  console.log(`[oai-sandbox] Loading env vars for agent ${identity.agentId}`);
  try {
    const apiClient = makeApiClient(identity);

    const { data } = await storageDownloadFileAgent({
      client: apiClient,
      path: { workspaceId: identity.workspaceId, orchestrationId: identity.orchestrationId, agentId: identity.agentId },
      query: { path: CONFIG_FILE_PATH },
    });
    const downloadUrl = (data as { download_url?: string })?.download_url;
    if (!downloadUrl) {
      console.log(`[oai-sandbox] No env var config found for agent ${identity.agentId}, proceeding with empty env`);
      return {};
    }
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      console.warn(`[oai-sandbox] Failed to download env var config for agent ${identity.agentId}: HTTP ${res.status}`);
      return {};
    }
    const pairs = await res.json() as { key: string; value: string }[];
    if (!pairs.length) {
      console.log(`[oai-sandbox] Env var config is empty for agent ${identity.agentId}`);
      return {};
    }

    console.log(`[oai-sandbox] Resolving ${pairs.length} env var(s) from agent settings for agent ${identity.agentId}`);
    const { data: settingsData } = await settingFindByAgent({
      client: apiClient,
      path: { workspaceId: identity.workspaceId, orchestrationId: identity.orchestrationId, agentId: identity.agentId },
    });
    const settings = (settingsData?.settings ?? []) as { setting_name: string; setting_type: string; text_value: string; boolean_value: boolean }[];
    const settingMap = Object.fromEntries(settings.map((s) => [
      s.setting_name,
      s.setting_type === "Boolean" ? String(s.boolean_value) : s.text_value,
    ]));

    const result: Record<string, string> = {};
    for (const { key, value: settingName } of pairs) {
      if (key && settingName in settingMap) {
        result[key] = settingMap[settingName];
      } else if (key) {
        console.warn(`[oai-sandbox] Setting "${settingName}" not found for env var "${key}" on agent ${identity.agentId} — skipping`);
      }
    }
    console.log(`[oai-sandbox] Resolved ${Object.keys(result).length}/${pairs.length} env var(s) for agent ${identity.agentId}`);
    return result;
  } catch (err) {
    console.warn(`[oai-sandbox] Failed to load env vars for agent ${identity.agentId}:`, err);
    return {};
  }
}

async function sendTickerTask(session: SessionRecord, message: string): Promise<void> {
  console.log(`[oai-sandbox] Sending ticker task to agent ${session.identity.agentId}`);
  const apiClient = makeApiClient(session.identity);
  await taskCreate({
    client: apiClient,
    path: {
      workspaceId: session.identity.workspaceId,
      orchestrationId: session.identity.orchestrationId,
      agentId: session.identity.agentId,
    },
    body: {
      message,
      session_id: session.agentSessionId,
    },
  });
  console.log(`[oai-sandbox] Ticker task sent to agent ${session.identity.agentId}`);
}

export async function pollAndProcessJobs(): Promise<void> {
  console.log("[oai-sandbox] Polling for pending jobs");
  let dispatched = 0;
  const iter = kv.list<JobRecord>({ prefix: ["sandbox_job"] });
  for await (const entry of iter) {
    const job = entry.value;
    if (job.status !== "pending") continue;
    const jobId = entry.key[1] as string;
    const count = await getSemaphore();
    if (count >= MAX_CONCURRENT) {
      console.log(`[oai-sandbox] Concurrency limit reached (${count}/${MAX_CONCURRENT}), skipping remaining pending jobs`);
      break;
    }
    // Claim the job atomically to avoid double-processing across isolates
    const claimed = await kv.atomic()
      .check(entry)
      .set(entry.key, { ...job, status: "running", startedAt: Date.now() } satisfies JobRecord)
      .commit();
    if (!claimed.ok) continue;
    console.log(`[oai-sandbox] Claimed job ${jobId}, dispatching`);
    processJob(jobId, job.sessionId, job.command!).catch((err) =>
      console.error(`[oai-sandbox] Unhandled error in processJob ${jobId}:`, err)
    );
    dispatched++;
  }
  console.log(`[oai-sandbox] Poll complete: ${dispatched} job(s) dispatched`);
}

async function processJob(jobId: string, sessionId: string, command: string): Promise<void> {
  console.log(`[oai-sandbox] Processing job ${jobId} for session ${sessionId}`);

  const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", sessionId]);
  if (!sessionEntry.value) {
    console.warn(`[oai-sandbox] Session ${sessionId} not found for job ${jobId} — dropping`);
    await kv.delete(["sandbox_job", jobId]);
    return;
  }
  const session = sessionEntry.value;

  await incrementSemaphore();

  try {
    const apiClient = makeApiClient(session.identity);

    const envVars = await loadEnvVars(session.identity);

    const webhookUrl = `${Deno.env.get("SERVICE_BASE_URL") ?? ""}/services/oai-sandbox/api/job-done/${session.layerId}/${jobId}`;
    const injectedCommand = `(${command}); _EC=$?; curl -sf -X POST '${webhookUrl}' -H 'Content-Type: application/json' -d "{\\\"exit_code\\\":$_EC}" || true; exit $_EC`;

    const sandboxOptions: SandboxOptions = {
      timeout: SANDBOX_TIMEOUT_SECS,
      env: envVars,
      region: SANDBOX_REGION,
    };
    if (session.mount && session.volumeId) {
      sandboxOptions.volumes = { [session.mount.local_path]: session.volumeId };
      console.log(`[oai-sandbox] Mounting volume ${session.volumeId} at ${session.mount.local_path} for job ${jobId}`);
    }

    console.log(`[oai-sandbox] Creating sandbox for job ${jobId} in region ${SANDBOX_REGION} with timeout ${SANDBOX_TIMEOUT_SECS}`);
    const sandbox = await Sandbox.create(sandboxOptions);
    console.log(`[oai-sandbox] Sandbox ${sandbox.id} created for job ${jobId}`);

    await kv.set(["sandbox_job", jobId], { sessionId, sandboxId: sandbox.id, status: "running", enqueuedAt: Date.now(), startedAt: Date.now() } satisfies JobRecord);

    if (session.mount) {
      console.log(`[oai-sandbox] Starting downsync for job ${jobId}: ${session.mount.scope}:${session.mount.remote_path} → ${session.mount.local_path}`);
      await downsync(sessionId, session.mount, sandbox, { identity: session.identity } as never, apiClient);
      console.log(`[oai-sandbox] Downsync complete for job ${jobId}`);
    }

    console.log(`[oai-sandbox] Executing command for job ${jobId} in sandbox ${sandbox.id}`);
    await sandbox.sh`${injectedCommand}`.sudo().noThrow();
    console.log(`[oai-sandbox] Command finished for job ${jobId}, closing sandbox connection`);
    await sandbox.close();

  } catch (err) {
    await decrementSemaphore();
    console.error(`[oai-sandbox] Job ${jobId} failed to start:`, err);

    const session2 = (await kv.get<SessionRecord>(["sandbox_session", sessionId])).value;
    if (session2) {
      await sendTickerTask(session2, `OAI Sandbox: Job ${jobId} failed to start. Error: ${err}`);
    }
    await kv.delete(["sandbox_job", jobId]);
  }
}

export async function finalizeJob(
  jobId: string,
  sessionId: string,
  exitCode: number,
): Promise<void> {
  console.log(`[oai-sandbox] Finalizing job ${jobId} for session ${sessionId} (exit code: ${exitCode})`);

  const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", sessionId]);
  if (!sessionEntry.value) {
    console.warn(`[oai-sandbox] Session ${sessionId} not found during finalization of job ${jobId} — skipping`);
    return;
  }
  const session = sessionEntry.value;

  const apiClient = makeApiClient(session.identity);

  const jobEntry = await kv.get<JobRecord>(["sandbox_job", jobId]);
  const sandboxId = jobEntry.value?.sandboxId;

  if (session.mount && sandboxId) {
    console.log(`[oai-sandbox] Reconnecting to sandbox ${sandboxId} for upsync of job ${jobId}`);
    try {
      const sandbox = await Sandbox.connect(sandboxId);
      console.log(`[oai-sandbox] Starting upsync for job ${jobId}: ${session.mount.local_path} → ${session.mount.scope}:${session.mount.remote_path}`);
      await upsync(sessionId, session.mount, sandbox, { identity: session.identity } as never, apiClient);
      console.log(`[oai-sandbox] Upsync complete for job ${jobId}, killing sandbox ${sandboxId}`);
      await sandbox.kill();
      console.log(`[oai-sandbox] Sandbox ${sandboxId} killed`);
    } catch (err) {
      console.warn(`[oai-sandbox] Upsync/kill failed for job ${jobId} (sandbox ${sandboxId}):`, err);
    }
  } else if (sandboxId) {
    console.log(`[oai-sandbox] No mount configured — killing sandbox ${sandboxId} for job ${jobId}`);
    try {
      const sandbox = await Sandbox.connect(sandboxId);
      await sandbox.kill();
      console.log(`[oai-sandbox] Sandbox ${sandboxId} killed`);
    } catch (err) {
      console.warn(`[oai-sandbox] Failed to kill sandbox ${sandboxId} for job ${jobId}:`, err);
    }
  } else {
    console.warn(`[oai-sandbox] No sandboxId recorded for job ${jobId} — cannot kill VM`);
  }

  await kv.set(["sandbox_session", sessionId], { ...session, lastJobAt: Date.now() } satisfies SessionRecord);
  await sendTickerTask(session, `OAI Sandbox: Job ${jobId} finished. Exit code: ${exitCode}`);
  await kv.delete(["sandbox_job", jobId]);
  await decrementSemaphore();
  console.log(`[oai-sandbox] Job ${jobId} finalized`);
}

export { kv };
