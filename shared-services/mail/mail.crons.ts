import { createApiClient } from "@orchestration-ai/sdk/services";
import { settingFindByAgent, layerFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { listMailAgents, unregisterMailAgent } from "./mail.kv.ts";
import { getImapCredentials, fetchUnseen } from "./imap.proxy.ts";
import { enqueueIfNotPending } from "./mail.tasks.ts";
import { MAIL_SERVICE_UNIQUE_NAME } from "./mail.constants.ts";
import type { Setting } from "@orchestration-ai/sdk/services";
import process from "node:process";

function makeApiClient(workspaceOwnerId: string) {
  const accessKey = process.env.OAI_ACCESS_KEY!;
  const clientId = process.env.OAI_CLIENT_ID!;
  const apiClient = createApiClient();
  setupClientCredentials(apiClient, {
    client_secret: accessKey,
    client_id: `${clientId}:${workspaceOwnerId}`,
  });
  return apiClient;
}

// Cron 1: Poll for new emails - every minute
Deno.cron("mail-email-poll", "* * * * *", async () => {
  const agents = await listMailAgents();
  if (!agents.length) return;
  console.log(`[mail:cron] Polling ${agents.length} agent(s) for new emails`);

  for (const agent of agents) {
    try {
      const apiClient = makeApiClient(agent.workspaceOwnerId);
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: agent.workspaceId,
          orchestrationId: agent.orchestrationId,
          agentId: agent.agentId,
        },
      });

      const credentials = getImapCredentials(data!.settings! as Setting[]);
      if (!credentials) {
        console.log(`[mail:cron] Agent ${agent.agentId} has no IMAP credentials - skipping`);
        continue;
      }

      const threads = await fetchUnseen(credentials);
      console.log(`[mail:cron] Agent ${agent.agentId}: ${threads.length} unseen thread(s)`);

      for (const thread of threads) {
        const attachmentNote = thread.attachmentFilenames.length
          ? `\nAttachments: ${thread.attachmentFilenames.join(", ")}`
          : "";
        const message =
          `New email(s) in thread.\nFrom: ${thread.from}\nSubject: ${thread.subject}\nDate: ${thread.date}\nMessages in thread: ${thread.messageCount}${attachmentNote}\n\nUse get_email with threadId "${thread.threadId}" to read the full thread.`;

        await enqueueIfNotPending(
          agent.workspaceId,
          agent.orchestrationId,
          agent.agentId,
          thread.threadId,
          message,
          apiClient,
        );
      }
    } catch (err) {
      console.warn(`[mail:cron] Error polling agent ${agent.agentId}:`, err);
    }
  }
});

// Cron 2: Cleanup agents that no longer have the mail service - every 15 minutes
Deno.cron("mail-agent-cleanup", "*/15 * * * *", async () => {
  const agents = await listMailAgents();
  if (!agents.length) return;
  console.log(`[mail:cron] Cleanup check for ${agents.length} agent(s)`);

  for (const agent of agents) {
    try {
      const apiClient = makeApiClient(agent.workspaceOwnerId);
      const { data } = await layerFindByAgent({
        client: apiClient,
        path: {
          workspaceId: agent.workspaceId,
          orchestrationId: agent.orchestrationId,
          agentId: agent.agentId,
        },
        query: { limit: 100 },
      });

      const layers = data?.layers ?? [];
      const hasMailService = layers.some((layer) =>
        layer.services?.some((s) => s.unique_name === MAIL_SERVICE_UNIQUE_NAME)
      );

      if (!hasMailService) {
        console.log(`[mail:cron] Agent ${agent.agentId} no longer has mail service - removing from registry`);
        await unregisterMailAgent(agent.agentId);
      }
    } catch (err) {
      console.warn(`[mail:cron] Error during cleanup check for agent ${agent.agentId}:`, err);
    }
  }
});
