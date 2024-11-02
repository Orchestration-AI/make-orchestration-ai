// @deno-types="npm:@types/express@5.0.0"
import express from "express";
import { Router } from "express";
import type { Request, Response } from "npm:@types/express@5.0.0";
import type { Context } from "../types.ts";
import process from "node:process";

export const voiceRouter = Router();

voiceRouter.post("/api/touch", async (_req: Request, res: Response) => {
  const context: Context = res.locals.context;

  const links = [
    {
      link_description:
        "Follow this link to chat to the agent using your voice.",
      link_name: "Chat to agent",
      link_url: `${process.env.VOICE_SERVICE_CHAT_URL}?layerId=${context.identity.layerId}`,
    },
  ];

  try {
    const promises = [
      fetch(
        `${process.env.ENGINE_URL}/agents/${context.identity.agentId}/links`,
        {
          method: "POST",
          body: JSON.stringify(links),
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

voiceRouter.get("/api/description", (_req: Request, res: Response) => {
  res.status(200).send([]);
});

