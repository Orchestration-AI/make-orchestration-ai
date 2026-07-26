import { createApiClient } from "@orchestration-ai/sdk/services";
import { taskCreate, storageDownloadFileAgent, settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { downsync, upsync } from "./oai-sandbox.sync.ts";
import { CONFIG_FILE_PATH, SANDBOX_REGION } from "./oai-sandbox.constants.ts";
import process from "node:process";

import { Sandbox, Client as SandboxClient, type SandboxOptions } from "@deno/sandbox";
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

const MAX_CONCURRENT = parseInt(process.env.SANDBOX_MAX_CONCURRENT ?? "2");
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

export async function decrementSemaphore(): Promise<void> {
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
        console.warn(`[oai-sandbox] Setting "${settingName}" not found for env var "${key}" on agent ${identity.agentId} - skipping`);
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
  console.log(`[oai-sandbox] Sending ticker task to agent ${session.identity.agentId} (session: ${session.agentSessionId ?? "none"})`);
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

const SANDBOX_HARD_LIMIT = 5;

async function getRunningCount(): Promise<number> {
  const sandboxes = await new SandboxClient().sandboxes.list();
  return sandboxes.filter((s) => s.status === "running").length;
}

export async function pollAndProcessJobs(): Promise<void> {
  console.log("[oai-sandbox] Polling for pending jobs");
  let dispatched = 0;
  const iter = kv.list<JobRecord>({ prefix: ["sandbox_job"] });
  for await (const entry of iter) {
    const job = entry.value;
    if (job.status !== "pending") continue;
    const jobId = entry.key[1] as string;
    const running = await getRunningCount();
    if (running >= SANDBOX_HARD_LIMIT) {
      console.log(`[oai-sandbox] Sandbox limit reached (${running}/${SANDBOX_HARD_LIMIT} running), skipping remaining pending jobs`);
      break;
    }
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
    console.warn(`[oai-sandbox] Session ${sessionId} not found for job ${jobId} - dropping`);
    await kv.delete(["sandbox_job", jobId]);
    return;
  }
  const session = sessionEntry.value;
  await incrementSemaphore();

  let sandbox: InstanceType<typeof Sandbox> | undefined;
  let apiClient: ReturnType<typeof makeApiClient> | undefined;

  try {
    apiClient = makeApiClient(session.identity);
    const envVars = await loadEnvVars(session.identity);

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
    sandbox = await Sandbox.create(sandboxOptions);
    console.log(`[oai-sandbox] Sandbox ${sandbox.id} created for job ${jobId}`);
  } catch (err) {
    console.error(`[oai-sandbox] Failed to create sandbox for job ${jobId}:`, err);
    await decrementSemaphore();
    await kv.delete(["sandbox_job", jobId]);
    await sendTickerTask(session, `OAI Sandbox: Job ${jobId} failed to start (sandbox creation error): ${err}`);
    return;
  }

  await kv.set(["sandbox_job", jobId], { sessionId, sandboxId: sandbox.id, status: "running", enqueuedAt: Date.now(), startedAt: Date.now() } satisfies JobRecord);

  try {
    if (session.mount) {
      console.log(`[oai-sandbox] Starting downsync for job ${jobId}`);
      await downsync(sessionId, session.mount, sandbox, { identity: session.identity } as never, apiClient);
      console.log(`[oai-sandbox] Downsync complete for job ${jobId}`);
    }

    console.log(`[oai-sandbox] Executing command for job ${jobId} in sandbox ${sandbox.id}`);
    const result = await sandbox.sh`${command}`.stdout("piped").stderr("piped").result();
    const exitCode = result.status.code ?? 0;
    const stdout = result.stdoutText ?? "";
    const stderr = result.stderrText ?? "";
    console.log(`[oai-sandbox] Command finished for job ${jobId} (exit code: ${exitCode})`);
    if (stdout) console.log(`[oai-sandbox] stdout for job ${jobId}:
${stdout}`);
    if (stderr) console.warn(`[oai-sandbox] stderr for job ${jobId}:
${stderr}`);

    await finalizeJob(jobId, sessionId, exitCode, stdout, stderr, sandbox, apiClient);

  } catch (err) {
    console.error(`[oai-sandbox] Job ${jobId} execution error:`, err);
    const exitCode = (err as { code?: number }).code ?? 1;
    const stderr = String(err);
    await finalizeJob(jobId, sessionId, exitCode, "", stderr, sandbox, apiClient);
  }
}

export async function finalizeJob(
  jobId: string,
  sessionId: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  sandbox: InstanceType<typeof Sandbox>,
  apiClient: ReturnType<typeof makeApiClient>,
): Promise<void> {
  console.log(`[oai-sandbox] Finalizing job ${jobId} for session ${sessionId} (exit code: ${exitCode})`);

  const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", sessionId]);
  if (!sessionEntry.value) {
    console.warn(`[oai-sandbox] Session ${sessionId} not found during finalization of job ${jobId} - skipping`);
    return;
  }
  const session = sessionEntry.value;

  if (session.mount) {
    console.log(`[oai-sandbox] Starting upsync for job ${jobId}`);
    try {
      await upsync(sessionId, session.mount, sandbox, { identity: session.identity } as never, apiClient);
      console.log(`[oai-sandbox] Upsync complete for job ${jobId}`);
    } catch (err) {
      console.warn(`[oai-sandbox] Upsync failed for job ${jobId}:`, err);
    }
  }

  try {
    await sandbox.kill();
    console.log(`[oai-sandbox] Sandbox killed for job ${jobId}`);
  } catch (err) {
    console.warn(`[oai-sandbox] Failed to kill sandbox for job ${jobId}:`, err);
  }

  await kv.set(["sandbox_session", sessionId], { ...session, lastJobAt: Date.now() } satisfies SessionRecord);

  const parts = [stdout ? "stdout:\n" + stdout : "", stderr ? "stderr:\n" + stderr : ""].filter(Boolean);
  const outputSummary = parts.join("\n\n");
  const tickerMsg = "OAI Sandbox: Job " + jobId + " finished. Exit code: " + exitCode + (outputSummary ? "\n\n" + outputSummary : "");
  await sendTickerTask(session, tickerMsg);

  await kv.delete(["sandbox_job", jobId]);
  await decrementSemaphore();
  console.log(`[oai-sandbox] Job ${jobId} finalized`);
}

export { kv };
