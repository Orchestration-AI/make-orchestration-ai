import { getContext } from "../context.middleware.ts";
import { sendMessages, createEngineClient } from "@orchestration-ai/sdk/services";
import type { Context } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { getRequiredEnvValue } from "../environment.ts";
import process from "node:process";
import type { Socket } from "socket.io";

let sockets: Socket[] = [];

export function sendMessageToAgent(message: string, context: Context, engineClient: Client) {
  return sendMessages(context.identity.agentId, 0, [{ message }], context.identity.layerId, engineClient);
}

export function addSocket(socket: Socket) {
  sockets.push(socket);

  socket.on("message", async (msg) => {
    const context = await getContext(msg.layerId);
    const engineClient = createEngineClient(
      process.env.ENGINE_URL ?? null,
      getRequiredEnvValue("OAI_ACCESS_KEY")
    );
    const response = await sendMessageToAgent(msg.message, context, engineClient);

    socket.emit("message", { message: response });
  });

  socket.on(
    "disconnect",
    () => (sockets = sockets.filter((s) => s.id !== socket.id))
  );
}
