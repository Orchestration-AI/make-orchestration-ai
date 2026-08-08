import type { Client } from "@orchestration-ai/sdk/app-builder";
import { storageUploadFileAgent } from "@orchestration-ai/sdk/sdk.gen";
import { putToSignedUrl } from "../oai-files/oai-files.service.ts";
import { appPath } from "../storage.ts";
import type { EmailAttachment } from "./imap.proxy.ts";

export type StoredAttachment = {
  filename: string;
  contentType: string;
  storagePath: string;
};

export async function storeAttachments(
  attachments: EmailAttachment[],
  threadId: string,
  messageId: string,
  workspaceId: string,
  orchestrationId: string,
  agentId: string,
  apiClient: Client,
): Promise<StoredAttachment[]> {
  const stored: StoredAttachment[] = [];
  for (const attachment of attachments) {
    const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeThread = threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeMsg = messageId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = appPath("emails", "attachments", safeThread, safeMsg, safeName);

    const { data } = await storageUploadFileAgent({
      client: apiClient,
      path: { workspaceId, orchestrationId, agentId },
      body: { path: storagePath, content_type: attachment.contentType },
    });

    if (!data?.upload_url) {
      console.warn(`[mail:attachments] Failed to get upload URL for ${storagePath}`);
      continue;
    }

    const bytes = Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0));
    await putToSignedUrl(data.upload_url, bytes, attachment.contentType, data.max_size_bytes ?? 104857600);
    stored.push({ filename: attachment.filename, contentType: attachment.contentType, storagePath });
  }
  return stored;
}
