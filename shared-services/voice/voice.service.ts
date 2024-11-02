import { getContext } from "../context.middleware.ts";
import { getRequiredEnvValue } from "../environment.ts";
import type { Context } from "../types.ts";
import type { Socket } from "socket.io";

let sockets: Socket[] = [];

async function sendMessageToAgent(message: string, context: Context) {
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const inferenceEndpointPrefix = getRequiredEnvValue("ENGINE_URL");
  const endpoint = `${inferenceEndpointPrefix}/agents/${context.identity.agentId}/layers/0/messages`;

  const response = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify([{ message }]),
    headers: {
      Authorization: `Bearer ${accessKey}`,
      "X-LayerId": context.identity.layerId,
      "Content-Type": "application/json",
    },
  });

  return response.text();
}

export function addSocket(socket: Socket) {
  sockets.push(socket);

  socket.on("message", async (msg) => {
    const context = await getContext(msg.layerId);
    const response = await sendMessageToAgent(msg.message, context);

    for (const socket of sockets) {
      socket.emit("message", { message: response });
    }
  });

  socket.on(
    "disconnect",
    () => (sockets = sockets.filter((s) => s.id !== socket.id))
  );
}
