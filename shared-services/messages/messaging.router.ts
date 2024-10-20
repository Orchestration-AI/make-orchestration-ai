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

export const messagingRouter = Router();

messagingRouter.get("/api/default-settings", (_req: Request, res: Response) => {
  res.status(200).json(defaultSettings);
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
