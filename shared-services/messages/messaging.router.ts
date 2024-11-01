import { Router } from "express";
import {
  messageLayerAbove,
  messageLayerBelow,
  messageOtherAgent,
} from "./messaging.service.ts";
import type { Request, Response } from "npm:@types/express@5.0.0";
import { defaultSettings } from "./messaging.constants.ts";
import type { Context } from "../types.ts";
import { getDescriptionForContext } from "./messaging.description.ts";
import process from "node:process";

export const messagingRouter = Router();

messagingRouter.get("/api/default-settings", (_req: Request, res: Response) => {
  res.status(200).json(defaultSettings);
});

messagingRouter.post("/api/touch", async (_req: Request, res: Response) => {
  const context: Context = res.locals.context;

  const links = [
    {
      link_description:
        "Follow this link to chat to the agent using your voice.",
      link_name: "Chat to agent",
      link_url: `${process.env.MESSAGING_SERVICE_APP_HOME_URL}?layerId=${context.identity.layerId}`,
    },
  ];

  const endpoints = [
    {
      description:
        "Make a POST request to this endpoint. The body should be an array of objects where each object has string message field.",
      endpoint: `${process.env.ENGINE_URL}/agents/${context.identity.agentId}/layers/0/messages`,
    },
  ];

  try {
    const promises = [
      (
        await fetch(
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
        )
      ).text(),

      (
        await fetch(
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
        )
      ).text(),
    ];

    await Promise.all(promises);
    res.status(204).send();
  } catch (e) {
    res.status(500).send(`${e}`);
  }
});

messagingRouter.post(
  "/api/message_other_agent",
  async (req: Request, res: Response) => {
    const context: Context = res.locals.context;
    try {
      const response = await messageOtherAgent(
        req.body.message,
        req.body.otherAgentId,
        context
      );
      res.status(200).send(response);
    } catch (e) {
      res.status(500).send(`${e}`);
    }
  }
);

messagingRouter.post(
  "/api/message_layer_below",
  async (req: Request, res: Response) => {
    const context: Context = res.locals.context;
    try {
      const response = await messageLayerBelow(req.body.message, context);
      res.status(200).send(response);
    } catch (e) {
      res.status(500).send(`${e}`);
    }
  }
);

messagingRouter.post(
  "/api/message_layer_above",
  async (req: Request, res: Response) => {
    const context: Context = res.locals.context;
    try {
      const response = await messageLayerAbove(req.body.message, context);
      res.status(200).send(response);
    } catch (e) {
      res.status(500).send(`${e}`);
    }
  }
);

messagingRouter.get("/api/description", (_req: Request, res: Response) => {
  const context: Context = res.locals.context;
  res.status(200).send(getDescriptionForContext(context));
});
