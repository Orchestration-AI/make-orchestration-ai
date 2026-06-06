import { getContext } from "../context.middleware.ts";
import { openStreamingChat, createApiClient, getTextSetting, getSecretSetting } from "@orchestration-ai/sdk/services";
import type { StreamingChat, Setting } from "@orchestration-ai/sdk/services";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { getRequiredEnvValue } from "../environment.ts";
// @deno-types="npm:@types/express@5.0.0"
import type { Request, Response } from "express";

interface ActiveCall {
  chat: StreamingChat;
  callControlId: string;
  apiKey: string;
  voice: string;
  pendingTranscript: string;
}

const activeCalls = new Map<string, ActiveCall>();

async function getSettings(layerId: string): Promise<Setting[]> {
  const context = await getContext(layerId);
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const apiClient = createApiClient();
  setupClientCredentials(apiClient, {
    client_id: accessKey,
    client_secret: `${accessKey}:${context.identity.workspaceOwnerId}`,
  });
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

async function telnyxCommand(apiKey: string, callControlId: string, command: string, params: Record<string, unknown> = {}) {
  await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${command}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
  });
}

function cleanupCall(callControlId: string) {
  const call = activeCalls.get(callControlId);
  if (call) {
    call.chat.close();
    activeCalls.delete(callControlId);
  }
}

async function handleCallInitiated(callControlId: string, layerId: string) {
  try {
    const settings = await getSettings(layerId);
    const apiKey = getSecretSetting(settings, "TELNYX_API_KEY") ?? "";
    const voice = getTextSetting(settings, "TELNYX_VOICE") ?? "female";
    const language = getTextSetting(settings, "TELNYX_TTS_LANGUAGE") ?? "en-US";
    const layerIndex = parseInt(getTextSetting(settings, "AGENT_LAYER") ?? "0", 10);

    const context = await getContext(layerId);

    let buffer = "";

    const flushBuffer = () => {
      const text = buffer.trim();
      buffer = "";
      if (text && activeCalls.has(callControlId)) {
        telnyxCommand(apiKey, callControlId, "speak", {
          payload: text,
          voice: voice,
          language: language,
        });
      }
    };

    const chat = openStreamingChat(context.identity.agentId, layerIndex, {
      onChunk: (chunk: string) => {
        buffer += chunk;
        // Flush on sentence-ending punctuation
        if (/[.!?\n]/.test(chunk)) {
          flushBuffer();
        }
      },
      onResponse: () => {
        // Flush any remaining buffered text
        flushBuffer();
      },
      onError: (err: string) => {
        console.warn(`[telnyx-voice] Chat error for ${callControlId}:`, err);
      },
      onClose: () => {
        activeCalls.delete(callControlId);
      },
    });

    activeCalls.set(callControlId, {
      chat,
      callControlId,
      apiKey,
      voice,
      pendingTranscript: "",
    });

    // Answer the call
    await telnyxCommand(apiKey, callControlId, "answer");
  } catch (e) {
    console.warn(`[telnyx-voice] Failed to answer call ${callControlId}:`, e);
    // Try to reject
    try {
      const settings = await getSettings(layerId);
      const apiKey = getSecretSetting(settings, "TELNYX_API_KEY") ?? "";
      await telnyxCommand(apiKey, callControlId, "reject", { cause: "CALL_REJECTED" });
    } catch { /* ignore */ }
  }
}

async function handleCallAnswered(callControlId: string) {
  const call = activeCalls.get(callControlId);
  if (!call) return;

  await telnyxCommand(call.apiKey, callControlId, "transcription_start", {
    language: "en",
  });
}

function handleTranscription(callControlId: string, transcript: string, isFinal: boolean) {
  const call = activeCalls.get(callControlId);
  if (!call) return;

  if (isFinal && transcript.trim()) {
    // Only send completed utterances to the agent
    call.chat.send(transcript.trim());
  }
}

function handleCallHangup(callControlId: string) {
  cleanupCall(callControlId);
}

export async function handleTelnyxWebhook(req: Request, res: Response) {
  const layerId = req.params.layerId;
  const event = req.body?.data;
  if (!event) {
    res.status(400).send("Missing event data");
    return;
  }

  const eventType = event.event_type;
  const callControlId = event.payload?.call_control_id;

  try {
    switch (eventType) {
      case "call.initiated":
        if (event.payload?.direction === "incoming") {
          await handleCallInitiated(callControlId, layerId);
        }
        break;
      case "call.answered":
        await handleCallAnswered(callControlId);
        break;
      case "call.transcription":
        handleTranscription(
          callControlId,
          event.payload?.transcription_data?.transcript ?? "",
          event.payload?.transcription_data?.is_final ?? false,
        );
        break;
      case "call.hangup":
        handleCallHangup(callControlId);
        break;
    }
    res.status(200).send("");
  } catch (e) {
    console.warn("[telnyx-voice] Webhook error:", e);
    res.status(500).send("");
  }
}
