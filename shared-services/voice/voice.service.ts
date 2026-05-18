import { getContext } from "../context.middleware.ts";
import { sendMessages, createEngineClient, createApiClient } from "@orchestration-ai/sdk/services";
import type { Context } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { authDecryptPasskey } from "@orchestration-ai/sdk/sdk.gen";
import { getRequiredEnvValue } from "../environment.ts";
import process from "node:process";
import type { Socket } from "socket.io";

export function sendMessageToAgent(message: string, context: Context, engineClient: Client) {
  return sendMessages(context.identity.agentId, 0, [{ message }], context.identity.layerId, engineClient);
}

export function addSocket(socket: Socket) {
  let cachedLayerId: string | null = null;

  socket.on("message", async (msg) => {
    const apiClient = createApiClient();
    const engineClient = createEngineClient(
      process.env.ENGINE_URL ?? null,
      getRequiredEnvValue("OAI_ACCESS_KEY")
    );

    if (!cachedLayerId) {
      const { data: decrypted } = await authDecryptPasskey({
        body: { passkey: msg.passkey },
        client: apiClient,
      });
      cachedLayerId = decrypted?.data as string;
    }
    
    const context = await getContext(cachedLayerId);
    const response = await sendMessageToAgent(msg.message, context, engineClient);

    socket.emit("message", { message: response });
  });

  socket.on(
    "disconnect",
    () => {}
  );
}
