// @deno-types="npm:@types/express@5.0.0"
import { Request, Response, Router } from "express";
import { defaultSettings } from "./mail.constants.ts";
import { Context } from "../types.ts";
import process from "node:process";
import { sendMarkdownMail } from "./mail.service.ts";
import { sendMessageToAgent } from "../voice/voice.service.ts";
import { getContext } from "../context.middleware.ts";
import { getDescriptionForContext } from "./mail.description.ts";

export const mailRouter = Router();

mailRouter.get("/api/default-settings", (_req: Request, res: Response) => {
  res.status(200).json(defaultSettings);
});

mailRouter.post("/api/touch", async (_req: Request, res: Response) => {
  const context: Context = res.locals.context;
  const endpoints = [
    {
      description:
        "Zapier email webhook. It is through this webhook the agent receives emails.",
      endpoint: `${process.env.MAIL_SERVICE_API_URL}/zapier/${context.identity.layerId}`,
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

mailRouter.post("/api/send_email", async (req: Request, res: Response) => {
  const context: Context = res.locals.context;
  try {
    await sendMarkdownMail(
      req.body.body,
      req.body.to,
      req.body.cc,
      req.body.bcc,
      req.body.subject,
      context.settings
    );

    res.status(200).send("Email sent.");
  } catch (e) {
    console.warn(e);
    res.status(500).send(`${e}`);
  }
});

mailRouter.post("/api/zapier/:layerId", async (req: Request, res: Response) => {
  const context: Context = await getContext(req.params.layerId);
  try {
    const markdownBody = req.body.body;
    const from = req.body.from;
    const cc = req.body.cc;
    const bcc = req.body.bcc;
    const subject = req.body.subject;

    let message = `New e-mail from ${from}\nSubject: ${subject}\n`;
    if(cc) {
      message += `Cc: ${cc}\n`;
    } else {
      // No Cc in the email
    }

    if(bcc) {
      message += `Bcc: ${bcc}\n`
    } else {
      // No Bcc in the email
    }

    const agentResponse = await sendMessageToAgent(
      `${message}\n${markdownBody}`,
      context
    );

    const response = await sendMarkdownMail(
      agentResponse,
      from,
      cc,
      bcc,
      `RE: ${subject}`,
      context.settings
    );

    res.status(200).send(response);
  } catch (e) {
    console.warn(e);
    res.status(500).send(`${e}`);
  }
});

mailRouter.get("/api/description", (_req: Request, res: Response) => {
  const context: Context = res.locals.context;
  res.status(200).send(getDescriptionForContext(context));
});
