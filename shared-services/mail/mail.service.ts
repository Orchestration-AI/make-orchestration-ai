// @deno-types=npm:@types/showdown@2.0.6
import showdown from "showdown";
import type { Setting } from "@orchestration-ai/sdk/services";
import { getBooleanSetting, getTextSetting } from "@orchestration-ai/sdk/services";
import { storageDownloadFileAgent } from "@orchestration-ai/sdk/sdk.gen";
import { getSecretSetting, type Client } from "@orchestration-ai/sdk/app-builder";
import {
  smtpHostSettingKey,
  smtpPortSettingKey,
  smtpUserSettingKey,
  smtpPasswordSettingKey,
  smtpSecureSettingKey,
  smtpSelfEmailSettingKey,
  mailFooterSettingKey,
} from "./mail.constants.ts";
import { getRequiredEnvValue } from "../environment.ts";
import { getImapCredentials, appendToSent } from "./imap.proxy.ts";

export function getMailerTransport(settings: Setting[]) {
  return {
    host: getTextSetting(settings, smtpHostSettingKey),
    port: parseInt(getTextSetting(settings, smtpPortSettingKey)?.trim() ?? "25"),
    secure: getBooleanSetting(settings, smtpSecureSettingKey),
    auth: {
      user: getTextSetting(settings, smtpUserSettingKey),
      pass: getSecretSetting(settings, smtpPasswordSettingKey) ?? getTextSetting(settings, smtpPasswordSettingKey),
    },
  };
}

type MailAttachment = { filename: string; content: string; contentType: string; encoding: string };

async function resolveAttachments(
  attachmentPaths: string[],
  workspaceId: string,
  orchestrationId: string,
  agentId: string,
  apiClient: Client,
): Promise<MailAttachment[]> {
  const result: MailAttachment[] = [];
  console.log(`[mail:attachments] Resolving ${attachmentPaths.length} attachment(s):`, attachmentPaths);
  for (const storagePath of attachmentPaths) {
    try {
      const { data } = await storageDownloadFileAgent({
        client: apiClient,
        path: { workspaceId, orchestrationId, agentId },
        query: { path: storagePath },
      });
      const downloadUrl = (data as { download_url?: string })?.download_url;
      if (!downloadUrl) {
        console.warn(`[mail:attachments] No download URL returned for ${storagePath}`);
        continue;
      }
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        console.warn(`[mail:attachments] Download failed for ${storagePath}: ${res.status} ${res.statusText}`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const filename = storagePath.split("/").pop() ?? "attachment";
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      console.log(`[mail:attachments] Resolved ${storagePath} -> ${filename} (${contentType}, ${bytes.byteLength} bytes)`);
      result.push({ filename, content: base64, contentType, encoding: "base64" });
    } catch (err) {
      console.warn(`[mail:attachments] Failed to resolve attachment ${storagePath}:`, err);
    }
  }
  console.log(`[mail:attachments] ${result.length}/${attachmentPaths.length} attachment(s) resolved successfully`);
  return result;
}

async function sendMail(
  htmlContent: string,
  textContent: string,
  to: string,
  cc: string,
  bcc: string,
  subject: string,
  settings: Setting[],
  sessionId?: string,
  attachments?: MailAttachment[],
) {
  const smtpFrom = getTextSetting(settings, smtpSelfEmailSettingKey);
  const transport = getMailerTransport(settings);
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const mailProxyUrl = getRequiredEnvValue("MAIL_PROXY_URL");

  const body: Record<string, unknown> = {
    transport,
    message: {
      from: smtpFrom,
      to,
      cc,
      bcc,
      subject,
      text: textContent,
      html: htmlContent,
      ...(sessionId ? { inReplyTo: sessionId, references: sessionId } : {}),
      ...(attachments?.length ? { attachments } : {}),
    },
  };

  return (
    await fetch(mailProxyUrl, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${accessKey}`,
        "Content-Type": "application/json",
      },
    })
  ).text();
}

export function sendMarkdownMail(
  markdown: string,
  to: string,
  cc: string,
  bcc: string,
  subject: string,
  settings: Setting[],
  sessionId?: string,
  attachmentPaths?: string[],
  workspaceId?: string,
  orchestrationId?: string,
  agentId?: string,
  apiClient?: Client,
) {
  const converter = new showdown.Converter();
  const html = converter.makeHtml(markdown);
  return sendMailWithContent(html, markdown, to, cc, bcc, subject, settings, sessionId, attachmentPaths, workspaceId, orchestrationId, agentId, apiClient);
}

export async function sendHtmlMail(
  html: string,
  to: string,
  cc: string,
  bcc: string,
  subject: string,
  settings: Setting[],
  sessionId?: string,
  attachmentPaths?: string[],
  workspaceId?: string,
  orchestrationId?: string,
  agentId?: string,
  apiClient?: Client,
) {
  return sendMailWithContent(html, html, to, cc, bcc, subject, settings, sessionId, attachmentPaths, workspaceId, orchestrationId, agentId, apiClient);
}

export function replyToThread(
  markdown: string,
  to: string,
  cc: string,
  subject: string,
  threadId: string,
  settings: Setting[],
  attachmentPaths?: string[],
  workspaceId?: string,
  orchestrationId?: string,
  agentId?: string,
  apiClient?: Client,
) {
  const converter = new showdown.Converter();
  const html = converter.makeHtml(markdown);
  return sendMailWithContent(html, markdown, to, cc, "", subject, settings, threadId, attachmentPaths, workspaceId, orchestrationId, agentId, apiClient);
}

async function sendMailWithContent(
  html: string,
  text: string,
  to: string,
  cc: string,
  bcc: string,
  subject: string,
  settings: Setting[],
  sessionId?: string,
  attachmentPaths?: string[],
  workspaceId?: string,
  orchestrationId?: string,
  agentId?: string,
  apiClient?: Client,
) {
  const footer = getTextSetting(settings, mailFooterSettingKey);
  const finalHtml = footer ? `${html}<br><br>${footer}` : html;
  const finalText = footer ? `${text}\n\n${footer}` : text;
  let attachments: MailAttachment[] | undefined;
  if (attachmentPaths?.length && workspaceId && orchestrationId && agentId && apiClient) {
    attachments = await resolveAttachments(attachmentPaths, workspaceId, orchestrationId, agentId, apiClient);
  } else if (attachmentPaths?.length) {
    const missing = [
      !workspaceId && "workspaceId",
      !orchestrationId && "orchestrationId",
      !agentId && "agentId",
      !apiClient && "apiClient",
    ].filter(Boolean);
    console.warn(`[mail] Skipping attachment resolution - missing: ${missing.join(", ")}`);
  }
  await sendMail(finalHtml, finalText, to, cc, bcc, subject, settings, sessionId, attachments);

  const imapCredentials = getImapCredentials(settings);
  if (imapCredentials) {
    const smtpFrom = getTextSetting(settings, smtpSelfEmailSettingKey);
    const rawMessage = [
      `From: ${smtpFrom}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      ...(bcc ? [`Bcc: ${bcc}`] : []),
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      finalHtml,
    ].join("\r\n");
    appendToSent(imapCredentials, rawMessage).catch((err) =>
      console.warn("[mail] Failed to append to Sent folder:", err),
    );
  }
}
