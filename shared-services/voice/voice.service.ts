import { getContext } from "../context.middleware.ts";
import { sendMessages, createEngineClient, createApiClient, getTextSetting } from "@orchestration-ai/sdk/services";
import type { Context, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { authDecryptPasskey, authGeneratePasskey, settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { getRequiredEnvValue } from "../environment.ts";
import process from "node:process";
// @deno-types="npm:@types/express@5.0.0"
import type { Request, Response } from "express";

export function sendMessageToAgent(message: string, context: Context, engineClient: Client, sessionId?: string) {
  return sendMessages(context.identity.agentId, 0, [{ message }], context.identity.layerId, engineClient, sessionId);
}

export async function handleStreamingChatInit(req: Request, res: Response) {
  try {
    const passkey = req.query.passkey as string;
    if (!passkey) { res.status(400).send("Missing passkey"); return; }

    const apiClient = createApiClient();
    const { data: decrypted } = await authDecryptPasskey({
      body: { passkey },
      client: apiClient,
    });
    const layerId = decrypted?.data as string;
    if (!layerId) { res.status(401).send("Invalid passkey"); return; }

    const context = await getContext(layerId);
    console.log(`[voice] Context: agentId=${context.identity.agentId} layerId=${context.identity.layerId}`);
    const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
    const clientId = getRequiredEnvValue("OAI_CLIENT_ID");

    console.log(`[voice] Setting up credentials for workspaceOwnerId=${context.identity.workspaceOwnerId}`);
    setupClientCredentials(apiClient, {
      client_secret: accessKey,
      client_id: `${clientId}:${context.identity.workspaceOwnerId}`,
    });

    const { data: settingsData } = await settingFindByAgent({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
    });
    const settings = (settingsData?.settings ?? []) as Setting[];
    const layerIndex = parseInt(getTextSetting(settings, "AGENT_LAYER") ?? "0", 10);

    const passkeyResponse = await authGeneratePasskey({ client: apiClient });
    if (passkeyResponse.error) {
      console.warn("[voice] authGeneratePasskey error:", passkeyResponse.error);
    }

    const inferencePasskey = passkeyResponse.data?.passkey;
    if (!inferencePasskey) {
      console.warn("[voice] Failed to generate inference passkey");
    }

    const engineClient = createEngineClient(process.env.ENGINE_URL ?? null, accessKey);
    const engineUrl = engineClient.getConfig().baseURL as string;

    res.json({
      agentId: context.identity.agentId,
      layerIndex,
      accessKey: inferencePasskey ?? "",
      engineUrl,
    });
  } catch (e) {
    console.error("[voice] Init failed:", e);
    res.status(500).send("Init failed");
  }
}
