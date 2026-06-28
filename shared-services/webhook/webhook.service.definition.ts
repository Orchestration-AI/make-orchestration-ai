import { defineService } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { endpointCreate } from "@orchestration-ai/sdk/sdk.gen";
import process from "node:process";

export const webhookService = defineService({
  unique_name: "webhook",
  service_name: "OAI Webhook",
  service_description: "Allows agents to receive JSON webhook events.",
  description: [],
  touch: async (context: Context, _engineClient: Client, apiClient: Client) => {
    await endpointCreate({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      body: {
        description: "Webhook endpoint. Use this to send events to this agent. Webhooks expose your agent to the public internet, so only use them for testing. Pass an optional 'X-Session-Id' header to maintain persisted conversation history across multiple requests.",
        endpoint: `${process.env.SELF_PUBLIC_URL}/services/webhook/api/event/${context.identity.layerId}`,
      },
    });
  },
});
