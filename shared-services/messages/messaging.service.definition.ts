import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { endpointCreate } from "@orchestration-ai/sdk/sdk.gen";
import { defaultSettings } from "./messaging.constants.ts";
import { getDescriptionForContext } from "./messaging.description.ts";
import {
  messageLayerAbove,
  messageLayerBelow,
  messageOtherAgent,
} from "./messaging.service.ts";
import process from "node:process";

export const messagingService = defineServiceWithDynamicDescription({
  unique_name: "messaging",
  service_name: "OAI Messaging",
  service_description: "Inter agent communication.",
  defaultSettings,
  description: getDescriptionForContext,
  touch: async (context: Context, _engineClient: Client, apiClient: Client) => {
    await endpointCreate({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      body: {
        description:
          "Make a POST request to this endpoint to message the agent. The body should be an array of objects where each object has string message field.",
        endpoint: `${process.env.ENGINE_URL}/agents/${context.identity.agentId}/layers/0/messages`,
      },
    });
  },
  tools: {
    message_other_agent: (body: { message: string; agentId: string }, context: Context, engineClient: Client, apiClient: Client) =>
      messageOtherAgent(body.message, body.agentId, context, engineClient, apiClient),
    message_layer_below: (body: { message: string }, context: Context, engineClient: Client) =>
      messageLayerBelow(body.message, context, engineClient),
    message_layer_above: (body: { message: string }, context: Context, engineClient: Client) =>
      messageLayerAbove(body.message, context, engineClient),
  },
});
