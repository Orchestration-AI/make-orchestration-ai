import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import type { Context, Setting, Client } from "@orchestration-ai/sdk/app-builder";
import { settingFindByAgent, linkCreate } from "@orchestration-ai/sdk/sdk.gen";
import { defaultSettings, smtpSelfEmailSettingKey, bodyMaxCharsSettingKey } from "./mail.constants.ts";
import { getDescriptionForContext } from "./mail.description.ts";
import { sendMarkdownMail, sendHtmlMail, replyToThread } from "./mail.service.ts";
import { registerMailAgent } from "./mail.kv.ts";
import { getImapCredentials, fetchList, fetchThread, fetchMessage, markThreadSeen, markMessageSeen } from "./imap.proxy.ts";
import { getTextSetting } from "@orchestration-ai/sdk/services";
import { storeAttachments } from "./mail.attachments.ts";
import PostalMime from "postal-mime";

async function extractPlainText(raw: string, bodyMaxChars: number): Promise<string> {
  const parsed = await new PostalMime().parse(raw);
  const text = parsed.text ?? parsed.html?.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim() ?? raw;
  return text.length > bodyMaxChars ? text.slice(0, bodyMaxChars) + "\n\n[Body truncated: content exceeds " + bodyMaxChars + " characters]" : text;
}

export const mailService = defineServiceWithDynamicDescription({
  unique_name: "mail",
  service_name: "OAI Mail",
  service_description: "Send and receive emails via SMTP and IMAP.",
  defaultSettings,
  description: getDescriptionForContext,
  touch: async (context: Context, _engineClient: Client, apiClient: Client) => {
    await registerMailAgent({
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
      workspaceOwnerId: context.identity.workspaceOwnerId,
      layerId: context.identity.layerId,
    });
    await linkCreate({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      body: {
        link_name: "Mail Credential Tester",
        link_description: "Test SMTP and IMAP credentials configured for this agent.",
        link_url: `${process.env.SELF_PUBLIC_URL}/services/mail/config`,
      },
    });
  },
  tools: {
    send_email: async (
      body: { body: string; to: string; cc: string; bcc: string; subject: string; attachments?: string },
      context: Context,
      _engineClient: Client,
      apiClient: Client,
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
        data!.settings! as Setting[],
        context.sessionId,
        body.attachments?.split(",").map((p) => p.trim()).filter(Boolean),
        context.identity.workspaceId,
        context.identity.orchestrationId,
        context.identity.agentId,
        apiClient,
      );
      return "Email sent.";
    },

    send_html_email: async (
      body: { html: string; to: string; cc: string; bcc: string; subject: string; attachments?: string },
      context: Context,
      _engineClient: Client,
      apiClient: Client,
    ) => {
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });
      await sendHtmlMail(
        body.html,
        body.to,
        body.cc,
        body.bcc,
        body.subject,
        data!.settings! as Setting[],
        context.sessionId,
        body.attachments?.split(",").map((p) => p.trim()).filter(Boolean),
        context.identity.workspaceId,
        context.identity.orchestrationId,
        context.identity.agentId,
        apiClient,
      );
      return "Email sent.";
    },

    list_emails: async (
      body: {
        folder?: string;
        limit?: number;
        since?: string;
        before?: string;
        from?: string;
        subject?: string;
        unseen_only?: boolean;
      },
      context: Context,
      _engineClient: Client,
      apiClient: Client,
    ) => {
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });
      const credentials = getImapCredentials(data!.settings! as Setting[]);
      if (!credentials) return "IMAP is not configured.";
      const threads = await fetchList(credentials, body);
      return threads;
    },

    get_email: async (
      body: { threadId?: string; uid?: string },
      context: Context,
      _engineClient: Client,
      apiClient: Client,
    ) => {
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });
      const credentials = getImapCredentials(data!.settings! as Setting[]);
      if (!credentials) return "IMAP is not configured.";
      const bodyMaxChars = +(getTextSetting(data!.settings! as Setting[], bodyMaxCharsSettingKey) ?? 20 * 1024) || 20 * 1024;

      if (body.threadId) {
        const messages = await fetchThread(credentials, body.threadId);
        const stored = [];
        for (const msg of messages) {
          const attachments = msg.attachments?.length
            ? await storeAttachments(
                msg.attachments,
                body.threadId,
                msg.messageId,
                context.identity.workspaceId,
                context.identity.orchestrationId,
                context.identity.agentId,
                apiClient,
              )
            : [];
          stored.push({ ...msg, body: await extractPlainText(msg.body, bodyMaxChars), attachments });
        }
        await markThreadSeen(credentials, body.threadId);
        return stored;
      }

      if (body.uid) {
        const msg = await fetchMessage(credentials, body.uid);
        const attachments = msg.attachments?.length
          ? await storeAttachments(
              msg.attachments,
              msg.messageId,
              msg.messageId,
              context.identity.workspaceId,
              context.identity.orchestrationId,
              context.identity.agentId,
              apiClient,
            )
          : [];
        await markMessageSeen(credentials, body.uid);
        const result = { ...msg, body: await extractPlainText(msg.body, bodyMaxChars), attachments };
        return result;
      }

      return "Provide either threadId or uid.";
    },

    reply_to_email: async (
      body: { threadId: string; body: string; attachments?: string },
      context: Context,
      _engineClient: Client,
      apiClient: Client,
    ) => {
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });
      const settings = data!.settings! as Setting[];
      const credentials = getImapCredentials(settings);
      if (!credentials) return "IMAP is not configured.";

      const messages = await fetchThread(credentials, body.threadId);
      if (!messages.length) return "Thread not found.";

      const latest = messages[messages.length - 1];
      const agentEmail = getTextSetting(settings, smtpSelfEmailSettingKey) ?? "";
      const extractAddress = (addr: string) => addr.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? addr.toLowerCase().trim();
      const agentAddress = extractAddress(agentEmail);

      // Reply-to: the sender of the latest message
      const replyTo = latest.from;

      // Preserve all CC participants from the latest message, excluding the agent itself
      const originalParticipants = [
        ...(latest.to?.split(",") ?? []),
        ...(latest.cc?.split(",") ?? []),
      ].map((a) => a.trim()).filter((a) => a && extractAddress(a) !== agentAddress);

      // Remove replyTo from cc to avoid duplication
      const cc = originalParticipants.filter((a) => extractAddress(a) !== extractAddress(replyTo)).join(", ");

      const subject = latest.subject
        ? (latest.subject.startsWith("Re:") ? latest.subject : `Re: ${latest.subject}`)
        : "Re: (no subject)";

      await replyToThread(
        body.body,
        replyTo,
        cc,
        subject,
        body.threadId,
        settings,
        body.attachments?.split(",").map((p) => p.trim()).filter(Boolean),
        context.identity.workspaceId,
        context.identity.orchestrationId,
        context.identity.agentId,
        apiClient,
      );
      return "Reply sent.";
    },
  },
});
