import { kv, type SessionRecord, type JobRecord, pollAndProcessJobs } from "./oai-sandbox.queue.ts";
import { upsync, deleteSyncState } from "./oai-sandbox.sync.ts";
import { createApiClient } from "@orchestration-ai/sdk/services";
import { taskCreate } from "@orchestration-ai/sdk/sdk.gen";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import process from "node:process";
import { Sandbox, Client as SandboxClient } from "@deno/sandbox";

const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_HOURS ?? "24") * 3_600_000;
const SANDBOX_TIMEOUT_MS = 30 * 60_000;

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

async function destroySession(sessionId: string, session: SessionRecord): Promise<void> {
  console.log(`[oai-sandbox:cron] Destroying session ${sessionId} for agent ${session.identity.agentId}`);
  await deleteSyncState(sessionId);
  if (session.volumeId) {
    console.log(`[oai-sandbox:cron] Deleting volume ${session.volumeId} for session ${sessionId}`);
    try {
      await new SandboxClient().volumes.delete(session.volumeId);
      console.log(`[oai-sandbox:cron] Volume ${session.volumeId} deleted`);
    } catch (err) {
      console.warn(`[oai-sandbox:cron] Failed to delete volume ${session.volumeId} for session ${sessionId}:`, err);
    }
  }
  await kv.delete(["sandbox_session", sessionId]);
  console.log(`[oai-sandbox:cron] Session ${sessionId} destroyed`);
}

// Cron 1: Session TTL - runs every hour
// Deno.cron("oai-sandbox-session-cleanup", "0 * * * *", async () => {
Deno.cron("oai-sandbox-session-cleanup", "0 5 31 2 *", async () => {
  console.log("[oai-sandbox:cron] Session TTL cleanup started");
  const now = Date.now();
  let checked = 0;
  let cleaned = 0;

  const iter = kv.list<SessionRecord>({ prefix: ["sandbox_session"] });
  for await (const entry of iter) {
    checked++;
    const session = entry.value;
    const ageMs = now - session.lastJobAt;
    if (ageMs > SESSION_TTL_MS) {
      const sessionId = entry.key[1] as string;
      console.log(`[oai-sandbox:cron] Session ${sessionId} expired (idle ${Math.round(ageMs / 3_600_000)}h), cleaning up`);
      await destroySession(sessionId, session);
      cleaned++;
    }
  }

  console.log(`[oai-sandbox:cron] Session TTL cleanup complete: ${checked} checked, ${cleaned} cleaned`);
});

// Cron 3: Job poll - runs every minute
// Deno.cron("oai-sandbox-job-poll", "* * * * *", async () => {
Deno.cron("oai-sandbox-job-poll", "0 5 31 2 *", async () => {
  await pollAndProcessJobs();
});

// Cron 2: Orphan detection - runs every 30 minutes
// Deno.cron("oai-sandbox-orphan-check", "*/30 * * * *", async () => {
Deno.cron("oai-sandbox-orphan-check", "0 5 31 2 *", async () => {
  console.log("[oai-sandbox:cron] Orphan detection started");
  const now = Date.now();
  let checked = 0;
  let orphaned = 0;

  const iter = kv.list<JobRecord>({ prefix: ["sandbox_job"] });
  for await (const entry of iter) {
    checked++;
    const job = entry.value;
    if (job.status !== "running") continue;
    if (!job.startedAt) continue;
    const runningMs = now - job.startedAt;
    if (runningMs < SANDBOX_TIMEOUT_MS) continue;

    const jobId = entry.key[1] as string;
    console.warn(`[oai-sandbox:cron] Orphaned job detected: ${jobId} (running ${Math.round(runningMs / 60_000)}m, session ${job.sessionId})`);
    orphaned++;

    await kv.set(entry.key, { ...job, status: "orphaned" } satisfies JobRecord);

    const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", job.sessionId]);
    if (!sessionEntry.value) {
      console.warn(`[oai-sandbox:cron] Session ${job.sessionId} not found for orphaned job ${jobId} - deleting job record`);
      await kv.delete(entry.key);
      continue;
    }
    const session = sessionEntry.value;
    const apiClient = makeApiClient(session.identity);

    if (session.mount && job.sandboxId) {
      console.log(`[oai-sandbox:cron] Reconnecting to sandbox ${job.sandboxId} for orphan upsync of job ${jobId}`);
      try {
        const sandbox = await Sandbox.connect(job.sandboxId);
        console.log(`[oai-sandbox:cron] Starting orphan upsync for job ${jobId}`);
        await upsync(job.sessionId, session.mount, sandbox, { identity: session.identity } as never, apiClient);
        console.log(`[oai-sandbox:cron] Orphan upsync complete for job ${jobId}, killing sandbox ${job.sandboxId}`);
        await sandbox.kill();
        console.log(`[oai-sandbox:cron] Sandbox ${job.sandboxId} killed`);
      } catch (err) {
        console.warn(`[oai-sandbox:cron] Orphan upsync/kill failed for job ${jobId} (sandbox ${job.sandboxId}):`, err);
      }
    } else if (job.sandboxId) {
      console.log(`[oai-sandbox:cron] Killing orphaned sandbox ${job.sandboxId} for job ${jobId} (no mount)`);
      try {
        const sandbox = await Sandbox.connect(job.sandboxId);
        await sandbox.kill();
        console.log(`[oai-sandbox:cron] Sandbox ${job.sandboxId} killed`);
      } catch (err) {
        console.warn(`[oai-sandbox:cron] Failed to kill orphaned sandbox ${job.sandboxId} for job ${jobId}:`, err);
      }
    } else {
      console.warn(`[oai-sandbox:cron] No sandboxId for orphaned job ${jobId} - cannot kill VM`);
    }

    try {
      await taskCreate({
        client: apiClient,
        path: {
          workspaceId: session.identity.workspaceId,
          orchestrationId: session.identity.orchestrationId,
          agentId: session.identity.agentId,
        },
        body: {
          message: `OAI Sandbox: Job ${jobId} was terminated (sandbox timeout after 30 minutes). Exit code: unknown.`,
          session_id: session.agentSessionId,
        },
      });
      console.log(`[oai-sandbox:cron] Agent notified of orphaned job ${jobId}`);
    } catch (err) {
      console.warn(`[oai-sandbox:cron] Failed to notify agent for orphaned job ${jobId}:`, err);
    }

    await kv.delete(entry.key);

    const countEntry = await kv.get<number>(["sandbox_running_count"]);
    const current = countEntry.value ?? 0;
    const next = Math.max(0, current - 1);
    await kv.atomic()
      .check(countEntry)
      .set(["sandbox_running_count"], next)
      .commit();
    console.log(`[oai-sandbox:cron] Semaphore decremented to ${next} after orphan cleanup of job ${jobId}`);
  }

  console.log(`[oai-sandbox:cron] Orphan detection complete: ${checked} checked, ${orphaned} orphaned`);
});
