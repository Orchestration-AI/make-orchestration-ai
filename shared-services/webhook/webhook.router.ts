// @deno-types="npm:@types/express@5.0.0"
import { Router, type Request, type Response } from "express";
import process from "node:process";
import type { Context } from "../types.ts";
import { getContext } from "../context.middleware.ts";
import { sendMessageToAgent } from "../voice/voice.service.ts";

export const webhookRouter = Router();

webhookRouter.post("/api/touch", async (_req: Request, res: Response) => {
  const context: Context = res.locals.context;

  const endpoints = [
    {
      description: "Webhook endpoint. Use this to send events to this agent.",
      endpoint: `${process.env.WEBHOOK_URL}/${context.identity.layerId}`,
    },
  ];

  try {
    const promises = [
      fetch(
        `${process.env.ENGINE_URL}/agents/${context.identity.agentId}/endpoints`,
        {
          method: "POST",
          body: JSON.stringify(endpoints),
          headers: {
            Authorization: `Bearer ${process.env.OAI_ACCESS_KEY}`,
            "Content-Type": "application/json",
            "X-LayerId": context.identity.layerId,
          },
        }
      ),
    ];

    await Promise.all(promises);
    res.status(204).send();
  } catch (e) {
    console.warn(e);
    res.status(500).send(`${e}`);
  }
});

webhookRouter.post(
  "/api/event/:layerId",
  async (req: Request, res: Response) => {
    try {
      const context: Context = await getContext(req.params.layerId);

      const body = JSON.stringify(req.body);
      const headersText = Object.entries(req.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");

      const agentResponse = await sendMessageToAgent(
        `New Webhook event\n\nHeaders:${headersText}\n\nJSON Body:\n${body}\n`,
        context
      );

      res.send(agentResponse);
    } catch (e) {
      console.warn(e);
      res.status(500).send(`${e}`);
    }
  }
);

webhookRouter.get("/api/description", (_req: Request, res: Response) => {
  res.status(200).send([]);
});
