import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import type { Context, Setting, Client } from "@orchestration-ai/sdk/app-builder";
import { endpointCreate, settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { defaultSettings } from "./mail.constants.ts";
import { getDescriptionForContext } from "./mail.description.ts";
import { sendMarkdownMail } from "./mail.service.ts";
import process from "node:process";

export const mailService = defineServiceWithDynamicDescription({
  unique_name: "mail",
  service_name: "OAI Mail",
  service_description: "Send emails email via SMTP.",
  defaultSettings,
  description: getDescriptionForContext,
  touch: async (context: Context, _engineClient: Client, apiClient: Client) => {
    await endpointCreate({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      body: {
        description:
          "Zapier email webhook. It is through this webhook the agent receives emails. Webhooks expose your agent to the public internet, so only use them for testing. Pass an optional 'X-Session-Id' header to maintain persisted conversation history across multiple requests.",
        endpoint: `${process.env.SELF_PUBLIC_URL}/services/mail/zapier/${context.identity.layerId}`,
      },
    });
  },
  tools: {
    send_email: async (
      body: { body: string; to: string; cc: string; bcc: string; subject: string },
      context: Context,
      _engineClient: Client,
      apiClient: Client
    ) => {
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });
      await sendMarkdownMail(
        body.body,
        body.to,
        body.cc,
        body.bcc,
        body.subject,
        data!.settings! as Setting[]
      );
      return "Email sent.";
    },
  },
});
