import type { Setting } from "@orchestration-ai/sdk/services";
import { getTextSetting, getBooleanSetting, getSecretSetting } from "@orchestration-ai/sdk/services";
import {
  imapHostSettingKey,
  imapPortSettingKey,
  imapUserSettingKey,
  imapPasswordSettingKey,
  imapSecureSettingKey,
} from "./mail.constants.ts";
import { getRequiredEnvValue } from "../environment.ts";

export type ImapCredentials = {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
};

export type EmailThread = {
  threadId: string;
  subject: string;
  from: string;
  date: string;
  messageCount: number;
  attachmentFilenames: string[];
};

export type EmailAttachment = {
  filename: string;
  contentType: string;
  size: number;
  data: string; // base64
};

export type EmailMessage = {
  uid: string;
  messageId: string;
  from: string;
  to: string;
  cc?: string;
  subject?: string;
  date: string;
  body: string;
  attachments: EmailAttachment[];
};

export type EmailListFilters = {
  folder?: string;
  limit?: number;
  since?: string;
  before?: string;
  from?: string;
  subject?: string;
  unseen_only?: boolean;
};

export function getImapCredentials(settings: Setting[]): ImapCredentials | null {
  const host = getTextSetting(settings, imapHostSettingKey);
  const user = getTextSetting(settings, imapUserSettingKey);
  const password = getSecretSetting(settings, imapPasswordSettingKey);
  if (!host || !user || !password) return null;
  return {
    host,
    port: parseInt(getTextSetting(settings, imapPortSettingKey)?.trim() ?? "993"),
    user,
    password,
    secure: getBooleanSetting(settings, imapSecureSettingKey) ?? true,
  };
}

async function callImapProxy(command: string, params: Record<string, unknown>): Promise<unknown> {
  const imapProxyUrl = getRequiredEnvValue("IMAP_PROXY_URL");
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const res = await fetch(imapProxyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command, ...params }),
  });
  if (!res.ok) throw new Error(`IMAP proxy error: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchUnseen(credentials: ImapCredentials): Promise<EmailThread[]> {
  const result = await callImapProxy("FETCH_UNSEEN", { credentials }) as { threads: EmailThread[] };
  return result.threads ?? [];
}

export async function fetchList(credentials: ImapCredentials, filters: EmailListFilters): Promise<EmailThread[]> {
  const result = await callImapProxy("FETCH_LIST", { credentials, filters }) as { threads: EmailThread[] };
  return result.threads ?? [];
}

export async function fetchThread(credentials: ImapCredentials, threadId: string): Promise<EmailMessage[]> {
  const result = await callImapProxy("FETCH_THREAD", { credentials, threadId }) as { messages: EmailMessage[] };
  return result.messages ?? [];
}

export async function fetchMessage(credentials: ImapCredentials, uid: string): Promise<EmailMessage> {
  const result = await callImapProxy("FETCH_MESSAGE", { credentials, uid }) as { message: EmailMessage };
  return result.message;
}

export async function markThreadSeen(credentials: ImapCredentials, threadId: string): Promise<void> {
  console.log(`[Marking thread ${threadId} as seen`);

  await Promise.all([
    callImapProxy("MARK_SEEN", { credentials, threadId }),
    callImapProxy("MARK_SEEN", { credentials, uid: threadId }),
  ]);
}

export async function markMessageSeen(credentials: ImapCredentials, uid: string): Promise<void> {
  console.log(`[Marking message ${uid} as seen`);

  await Promise.all([
    callImapProxy("MARK_SEEN", { credentials, uid }),
    callImapProxy("MARK_SEEN", { credentials, threadId: uid }),
  ]);
}

export async function appendToSent(credentials: ImapCredentials, rawMessage: string): Promise<void> {
  await callImapProxy("APPEND_SENT", { credentials, rawMessage });
}
