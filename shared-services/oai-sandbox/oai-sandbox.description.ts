import type { Context, ServiceDescription, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { SANDBOX_WORKSPACE_MOUNT_KEY, SANDBOX_ORCHESTRATION_MOUNT_KEY } from "./oai-sandbox.constants.ts";

export function boolSetting(settings: Setting[], key: string): boolean {
  const s = settings.find((s) => s.setting_name === key);
  return s?.setting_type === "Boolean" ? s.boolean_value : false;
}

export async function loadSettings(context: Context, apiClient: Client): Promise<Setting[]> {
  const { data } = await settingFindByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
  });
  return (data?.settings ?? []) as Setting[];
}

export async function getSandboxDescription(
  context: Context,
  _engineClient: Client,
  apiClient: Client,
): Promise<ServiceDescription> {
  const settings = await loadSettings(context, apiClient);
  const workspaceMount = boolSetting(settings, SANDBOX_WORKSPACE_MOUNT_KEY);
  const orchMount = boolSetting(settings, SANDBOX_ORCHESTRATION_MOUNT_KEY);

  const mountScopes = ["agent"];
  if (orchMount) mountScopes.push("orchestration");
  if (workspaceMount) mountScopes.push("workspace");
  const scopeList = mountScopes.join(", ");

  return [
    {
      path: "create_session",
      method: "POST",
      description: `Part of OAI Sandbox. Creates a new sandbox session and returns a sessionId. Optionally attach a volume mount to sync OAI Files into the VM before each job and back after. Available mount scopes: ${scopeList}. IMPORTANT: Only the mounted directory is guaranteed to persist state between jobs - the rest of the VM filesystem is ephemeral and may be reset between runs. If you install tools or download files that you want to reuse across jobs, place them inside the mounted directory.`,
      parameters: {
        mount_scope: {
          type: "string",
          optional: true,
          description: `Scope of the OAI Files to mount. One of: ${scopeList}.`,
        },
        mount_remote_path: {
          type: "string",
          optional: true,
          description: "Path in OAI Files to sync from/to (e.g. 'project/files').",
        },
        mount_local_path: {
          type: "string",
          optional: true,
          description: "Absolute or relative path inside the VM where files will be mounted (e.g. '/data/workspace'). This is the only directory guaranteed to persist between jobs.",
        },
      },
    },
    {
      path: "run_command",
      method: "POST",
      description: "Part of OAI Sandbox. Enqueues a shell command to run in a Linux VM for the given session. Returns a jobId immediately - the command runs asynchronously and you will receive a ticker notification when it completes. IMPORTANT: After calling run_command, immediately inform the user that the job has been queued and end your response - do not call run_command again or continue iterating. The ticker notification will arrive as a new user message when the job completes; resume work at that point. Queueing multiple jobs simultaneously leads to unpredictable state. Jobs have a hard timeout of 30 minutes - at 30 minutes the VM is forcibly terminated regardless of what is running. Plan long-running work accordingly and break it into smaller jobs if needed. When a job finishes (or is terminated), upsync runs automatically - any files written to the mounted directory are synced back to OAI Files before the ticker notification is sent, so you do not need to manually upload results. Only the mounted directory is synced; files written elsewhere in the VM are lost when the job ends.",
      parameters: {
        session_id: { type: "string", optional: false, description: "Session ID returned by create_session." },
        command: { type: "string", optional: false, description: "Shell command to execute in the VM. This value will be passed to bash via the -c argument. Write any output files you want to keep to the mounted directory so they are automatically upsynced on completion." },
      },
    },
    {
      path: "end_session",
      method: "POST",
      description: "Part of OAI Sandbox. Ends a session and destroys its local volume mount state. Call this when you are done with a session to free resources. Ensure any important files have been written to the mounted directory before ending - upsync only runs automatically at job completion, not at session end.",
      parameters: {
        session_id: { type: "string", optional: false, description: "Session ID to end." },
      },
    },
  ];
}
