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
      description: `Part of OAI Sandbox. Creates a sandbox session and returns a sessionId. Optionally mount an OAI Files directory to sync files into the VM before each job and back out after. Available mount scopes: ${scopeList}. Only the mounted directory persists between jobs - everything else is ephemeral.`,
      parameters: {
        mount_scope: {
          type: "string",
          optional: true,
          description: `OAI Files scope to mount. One of: ${scopeList}.`,
        },
        mount_remote_path: {
          type: "string",
          optional: true,
          description: "Path in OAI Files to sync from/to (e.g. 'project/files').",
        },
        mount_local_path: {
          type: "string",
          optional: true,
          description: "Absolute path in the VM where files will be mounted (e.g. '/data/workspace'). Only this directory persists between jobs.",
        },
      },
    },
    {
      path: "run_command",
      method: "POST",
      description: "Part of OAI Sandbox. Enqueues a shell command to run in a Linux VM. Returns a jobId immediately - the command runs asynchronously. After calling run_command, tell the user the job is queued and stop. Do not call run_command again until you receive the ticker notification (it arrives as a new user message when the job completes). The command is run as: bash -c '<your command>' - do not prefix it with bash or bash -c yourself. Jobs time out after 30 minutes. On completion, files in the mounted directory are automatically synced back to OAI Files.",
      parameters: {
        session_id: { type: "string", optional: false, description: "Session ID from create_session." },
        command: { type: "string", optional: false, description: "The command to run. Do not wrap it in bash or bash -c - it is already run as bash -c '<command>'. Write output files to the mounted directory so they are synced back automatically." },
      },
    },
    {
      path: "end_session",
      method: "POST",
      description: "Part of OAI Sandbox. Ends a session and cleans up its resources. Call this when you are done. Make sure any files you need are in the mounted directory before ending - upsync only runs at job completion, not at session end.",
      parameters: {
        session_id: { type: "string", optional: false, description: "Session ID to end." },
      },
    },
  ];
}
