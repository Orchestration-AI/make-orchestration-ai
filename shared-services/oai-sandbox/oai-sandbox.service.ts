import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { kv, type SessionRecord, type JobRecord } from "./oai-sandbox.queue.ts";
import { deleteSyncState, type MountConfig } from "./oai-sandbox.sync.ts";
import { SANDBOX_WORKSPACE_MOUNT_KEY, SANDBOX_ORCHESTRATION_MOUNT_KEY, SANDBOX_REGION } from "./oai-sandbox.constants.ts";
import { boolSetting, loadSettings } from "./oai-sandbox.description.ts";
import { Volume, Client as SandboxClient } from "@deno/sandbox";

type CreateSessionBody = {
  mount_scope?: string;
  mount_remote_path?: string;
  mount_local_path?: string;
};
type RunCommandBody = { session_id: string; command: string };
type EndSessionBody = { session_id: string };

export async function createSession(body: CreateSessionBody, context: Context, _e: Client, apiClient: Client) {
  console.log(`[oai-sandbox] createSession called for agent ${context.identity.agentId}`);

  let mount: MountConfig | undefined;
  if (body.mount_scope && body.mount_remote_path && body.mount_local_path) {
    mount = {
      scope: body.mount_scope as MountConfig["scope"],
      remote_path: body.mount_remote_path,
      local_path: body.mount_local_path,
    };
    console.log(`[oai-sandbox] Mount requested: scope=${mount.scope} remote=${mount.remote_path} local=${mount.local_path}`);
  }

  if (mount) {
    const settings = await loadSettings(context, apiClient);
    if (mount.scope === "workspace" && !boolSetting(settings, SANDBOX_WORKSPACE_MOUNT_KEY)) {
      console.warn(`[oai-sandbox] Workspace mount denied for agent ${context.identity.agentId} - setting not enabled`);
      throw new Error("Workspace-scoped mounts are not enabled for this agent.");
    }
    if (mount.scope === "orchestration" && !boolSetting(settings, SANDBOX_ORCHESTRATION_MOUNT_KEY)) {
      console.warn(`[oai-sandbox] Orchestration mount denied for agent ${context.identity.agentId} - setting not enabled`);
      throw new Error("Orchestration-scoped mounts are not enabled for this agent.");
    }
  }

  const sessionId = crypto.randomUUID();

  let volumeId: string | undefined;
  if (mount) {
    console.log(`[oai-sandbox] Creating 16GB volume in region ${SANDBOX_REGION} for session ${sessionId}`);
    const volume = await Volume.create({
      slug: `oai-sb-${sessionId.slice(0, 8)}`,
      region: SANDBOX_REGION,
      capacity: "16GB",
    });
    volumeId = volume.id;
    console.log(`[oai-sandbox] Volume ${volumeId} created (slug: oai-sandbox-${sessionId})`);
  }

  const record: SessionRecord = {
    layerId: context.identity.layerId,
    identity: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
      workspaceOwnerId: context.identity.workspaceOwnerId,
    },
    mount: mount,
    volumeId,
    lastJobAt: Date.now(),
    agentSessionId: context.sessionId,
  };

  await kv.set(["sandbox_session", sessionId], record);
  console.log(`[oai-sandbox] Session ${sessionId} created for agent ${context.identity.agentId}${volumeId ? ` with volume ${volumeId}` : " (no mount)"}`);
  return { session_id: sessionId };
}

export async function runCommand(body: RunCommandBody, context: Context, _e: Client, _apiClient: Client) {
  console.log(`[oai-sandbox] runCommand called for session ${body.session_id}`);

  const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", body.session_id]);
  if (!sessionEntry.value) throw new Error(`Session ${body.session_id} not found.`);

  const currentAgentSessionId = context.sessionId;
  if (currentAgentSessionId && currentAgentSessionId !== sessionEntry.value.agentSessionId) {
    await kv.set(["sandbox_session", body.session_id], { ...sessionEntry.value, agentSessionId: currentAgentSessionId } satisfies SessionRecord);
  }

  const jobId = crypto.randomUUID();
  const jobRecord: JobRecord = {
    sessionId: body.session_id,
    status: "pending",
    enqueuedAt: Date.now(),
    command: body.command,
  };

  await kv.set(["sandbox_job", jobId], jobRecord);

  console.log(`[oai-sandbox] Job ${jobId} queued (pending) for session ${body.session_id}`);
  return { job_id: jobId };
}

export async function endSession(body: EndSessionBody, _context: Context, _e: Client, _apiClient: Client) {
  console.log(`[oai-sandbox] endSession called for session ${body.session_id}`);

  const sessionEntry = await kv.get<SessionRecord>(["sandbox_session", body.session_id]);
  if (!sessionEntry.value) throw new Error(`Session ${body.session_id} not found.`);

  await deleteSyncState(body.session_id);

  if (sessionEntry.value.volumeId) {
    console.log(`[oai-sandbox] Deleting volume ${sessionEntry.value.volumeId} for session ${body.session_id}`);
    try {
      await new SandboxClient().volumes.delete(sessionEntry.value.volumeId);
      console.log(`[oai-sandbox] Volume ${sessionEntry.value.volumeId} deleted`);
    } catch (err) {
      console.warn(`[oai-sandbox] Failed to delete volume ${sessionEntry.value.volumeId}:`, err);
    }
  }

  await kv.delete(["sandbox_session", body.session_id]);
  console.log(`[oai-sandbox] Session ${body.session_id} ended and removed`);

  return { success: true };
}

// Register queue listener - called once at startup from app.ts
export function registerQueueListener(): void {
  console.log("[oai-sandbox] Queue listener skipped (using poll-based processing)");
}
