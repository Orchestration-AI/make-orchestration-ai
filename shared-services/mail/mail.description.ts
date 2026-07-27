import type { Context, ServiceDescription, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { getBooleanSetting, getTextSetting } from "@orchestration-ai/sdk/services";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { autoSendSettingKey, imapHostSettingKey } from "./mail.constants.ts";

export async function getDescriptionForContext(context: Context, _engineClient: Client, apiClient: Client): Promise<ServiceDescription> {
  const { data } = await settingFindByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
  });
  const settings = data!.settings! as Setting[];
  const autoSend = getBooleanSetting(settings, autoSendSettingKey);
  const hasImap = !!getTextSetting(settings, imapHostSettingKey);

  const tools: ServiceDescription = [];

  if (autoSend) {
    tools.push({
      path: "send_email",
      method: "POST",
      description: "Send an email. Body is written in markdown.",
      parameters: {
        body: { type: "string", optional: false, description: "The email body in markdown." },
        subject: { type: "string", optional: false, description: "The email subject." },
        to: { type: "string", optional: false, description: "Comma-separated recipient addresses for the To field." },
        cc: { type: "string", optional: true, description: "Comma-separated recipient addresses for the Cc field." },
        bcc: { type: "string", optional: true, description: "Comma-separated recipient addresses for the Bcc field." },
        attachments: { type: "string", optional: true, description: "Comma-separated OAI storage paths of files to attach." },
      },
    });
    tools.push({
      path: "send_html_email",
      method: "POST",
      description: "Send an email with an HTML body.",
      parameters: {
        html: { type: "string", optional: false, description: "The email body as raw HTML." },
        subject: { type: "string", optional: false, description: "The email subject." },
        to: { type: "string", optional: false, description: "Comma-separated recipient addresses for the To field." },
        cc: { type: "string", optional: true, description: "Comma-separated recipient addresses for the Cc field." },
        bcc: { type: "string", optional: true, description: "Comma-separated recipient addresses for the Bcc field." },
        attachments: { type: "string", optional: true, description: "Comma-separated OAI storage paths of files to attach." },
      },
    });
  }

  if (hasImap) {
    tools.push({
      path: "reply_to_email",
      method: "POST",
      description: "Reply to an existing email thread. Participants are taken directly from the thread - no recipients can be added or removed.",
      parameters: {
        threadId: { type: "string", optional: false, description: "The thread ID to reply to." },
        body: { type: "string", optional: false, description: "The reply body in markdown." },
        attachments: { type: "string", optional: true, description: "Comma-separated OAI storage paths of files to attach." },
      },
    });
    tools.push({
      path: "list_emails",
      method: "POST",
      description: "List email threads from the inbox with optional filters.",
      parameters: {
        folder: { type: "string", optional: true, description: "Mailbox folder to list (default: INBOX)." },
        limit: { type: "number", optional: true, description: "Maximum number of threads to return (default: 20)." },
        since: { type: "string", optional: true, description: "ISO date - only emails after this date." },
        before: { type: "string", optional: true, description: "ISO date - only emails before this date." },
        from: { type: "string", optional: true, description: "Filter by sender address." },
        subject: { type: "string", optional: true, description: "Filter by subject containing this string." },
        unseen_only: { type: "boolean", optional: true, description: "Only return unread emails." },
      },
    });
    tools.push({
      path: "get_email",
      method: "POST",
      description: "Fetch a full email thread or a single message by UID. Attachments are stored in OAI storage and their paths are returned.",
      parameters: {
        threadId: { type: "string", optional: true, description: "The thread ID to fetch all messages in the thread." },
        uid: { type: "string", optional: true, description: "The UID of a specific message to fetch." },
      },
    });
  }

  return tools;
}
