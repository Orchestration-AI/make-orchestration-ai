import { defineService } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { linkCreate } from "@orchestration-ai/sdk/sdk.gen";
import process from "node:process";

export const voiceService = defineService({
  unique_name: "voice",
  service_name: "OAI Voice",
  service_description: "Voice communication with the user.",
  description: [],
  touch: async (context: Context, _engineClient: Client, apiClient: Client) => {
    await linkCreate({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      body: {
        link_description:
          "Follow this link to chat to the agent using your voice.",
        link_name: "Chat to agent",
        link_url: `${process.env.SELF_PUBLIC_URL}/services/voice/chat`,
      },
    });
  },
});
