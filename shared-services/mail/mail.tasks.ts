import type { Client } from "@orchestration-ai/sdk/app-builder";
import { taskFindActiveByAgent, taskCreate } from "@orchestration-ai/sdk/sdk.gen";

export async function enqueueIfNotPending(
  workspaceId: string,
  orchestrationId: string,
  agentId: string,
  threadId: string,
  message: string,
  apiClient: Client,
): Promise<void> {
  const { data } = await taskFindActiveByAgent({
    client: apiClient,
    path: { workspaceId, orchestrationId, agentId },
    query: { limit: 1000 },
  });

  const alreadyPending = data?.tasks?.some((t) => t.session_id === threadId);
  if (alreadyPending) {
    console.log(`[mail:tasks] Task for thread ${threadId} already pending - skipping`);
    return;
  }

  await taskCreate({
    client: apiClient,
    path: { workspaceId, orchestrationId, agentId },
    body: { message, session_id: threadId },
  });
  console.log(`[mail:tasks] Task created for thread ${threadId} on agent ${agentId}`);
}
