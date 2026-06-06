import { defineService } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { endpointCreate } from "@orchestration-ai/sdk/sdk.gen";
import process from "node:process";

export const telnyxVoiceService = defineService({
  unique_name: "telnyx-voice",
  service_name: "Telnyx Voice",
  service_description:
    "Allows agents to respond to inbound phone calls using Telnyx.",
  defaultSettings: [
    {
      setting_name: "TELNYX_API_KEY",
      setting_description: "Telnyx API v2 key for authenticating call control requests.",
      setting_type: "Secret",
      text_value: "",
    },
    {
      setting_name: "TELNYX_VOICE",
      setting_description:
        "Voice used for text-to-speech. See available voices: https://developers.telnyx.com/docs/voice/tts/overview#2-choose-a-pre-built-voice",
      setting_type: "Text",
      text_value: "female",
    },
    {
      setting_name: "TELNYX_TTS_LANGUAGE",
      setting_description: "Language code for text-to-speech (e.g. en-US, es-ES, fr-FR).",
      setting_type: "Text",
      text_value: "en-US",
    },
    {
      setting_name: "AGENT_LAYER",
      setting_description: "Layer index to use when communicating with the agent (defaults to 0).",
      setting_type: "Text",
      text_value: "0",
    },
  ],
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
        description:
          "Telnyx v2 webhook endpoint. Paste this URL into your Telnyx Call Control App webhook settings.",
        endpoint: `${process.env.TELNYX_VOICE_WEBHOOK_URL}/${context.identity.layerId}`,
      },
    });
  },
});
