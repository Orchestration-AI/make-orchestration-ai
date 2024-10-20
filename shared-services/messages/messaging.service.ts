import type { Context, Setting } from "../types.ts";
import { getRequiredEnvValue } from "../environment.ts";
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

export function messageLayerBelow(message: string, context: Context) {
  const layerBelowIndex = context.identity.layerIndex + 1;
  return messageLayerByIndex(
    message,
    context.identity.layerId,
    context.identity.agentId,
    layerBelowIndex,
    context.settings
  );
}

export function messageLayerAbove(message: string, context: Context) {
  const layerAboveIndex = context.identity.layerIndex - 1;
  return messageLayerByIndex(
    message,
    context.identity.layerId,
    context.identity.agentId,
    layerAboveIndex,
    context.settings
  );
}

export function messageOtherAgent(
  message: string,
  otherAgentId: string,
  context: Context
) {
  return messageLayerByIndex(
    message,
    context.identity.layerId,
    otherAgentId,
    0,
    context.settings
  );
}

async function messageLayerByIndex(
  message: string,
  sendingLayerId: string,
  recepientAgentId: string,
  recepientLayerIndex: number,
  settings: Setting[]
) {
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const inferenceEndpointPrefix = getRequiredEnvValue("INFERENCE_URL_PREFIX");
  const endpoint = `${inferenceEndpointPrefix}/agents/${recepientAgentId}/layers/${recepientLayerIndex}/messages`;

  const responsePromise = fetch(endpoint, {
    method: "POST",
    body: JSON.stringify([{ message }]),
    headers: {
      Authorization: `Bearer ${accessKey}`,
      "X-LayerId": sendingLayerId,
      "Content-Type": "application/json",
    },
  });

  if (asyncMessagingEnabled(settings)) {
    responsePromise
      .then((response) => {
        console.info(`Async response received. Status ${response.status}.`);
        return response.text();
      })
      .then(console.info);

    return "MESSAGE_RECEIVED";
  } else {
    const response = await responsePromise;
    return response.text();
  }
}
