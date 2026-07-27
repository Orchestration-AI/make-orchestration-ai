import type { Context, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { sendMessages } from "@orchestration-ai/sdk/services";
import { agentFindById, settingFindByAgent, taskCreate } from "@orchestration-ai/sdk/sdk.gen";
import { asyncMessagingSettingKey } from "./messaging.constants.ts";

function asyncMessagingEnabled(settings: Setting[]): boolean {
  const setting = settings.find(
    (setting) => setting.setting_name === asyncMessagingSettingKey
  );

  if (setting?.setting_type === "Boolean") {
    return setting.boolean_value;
  } else {
    return false;
  }
}

export function messageLayerBelow(message: string, context: Context, engineClient: Client) {
  console.log(`[messaging] Messaging layer below for agent ${context.identity.agentId}`);
  const layerBelowIndex = context.identity.layerIndex + 1;
  return sendMessages(context.identity.agentId, layerBelowIndex, [{ message }], context.identity.layerId, engineClient);
}

export function messageLayerAbove(message: string, context: Context, engineClient: Client) {
  console.log(`[messaging] Messaging layer above for agent ${context.identity.agentId}`);
  const layerAboveIndex = context.identity.layerIndex - 1;
  return sendMessages(context.identity.agentId, layerAboveIndex, [{ message }], context.identity.layerId, engineClient);
}

export async function messageOtherAgent(
  message: string,
  otherAgentId: string,
  context: Context,
  engineClient: Client,
  apiClient: Client
) {
  console.log(`[messaging] Messaging other agent ${otherAgentId} from agent ${context.identity.agentId}`);
  const { data } = await settingFindByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
  });
  const isAsync = asyncMessagingEnabled(data!.settings! as Setting[]);

  if (isAsync) {
    const { data: agentData } = await agentFindById({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        id: otherAgentId,
      },
    });
    const orchestrationId = agentData?.orchestration?.id ?? context.identity.orchestrationId;
    const workspaceId = agentData?.orchestration?.workspace?.id ?? context.identity.workspaceId;
    await taskCreate({
      client: apiClient,
      path: { workspaceId, orchestrationId, agentId: otherAgentId },
      body: { message },
    });
    return "MESSAGE_RECEIVED";
  } else {
    return sendMessages(otherAgentId, 0, [{ message }], context.identity.layerId, engineClient);
  }
}
