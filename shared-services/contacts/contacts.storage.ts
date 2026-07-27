import type { Context } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { storageDownloadFileAgent, storageUploadFileAgent } from "@orchestration-ai/sdk/sdk.gen";
import { putToSignedUrl } from "../oai-files/oai-files.service.ts";
import { CONTACTS_STORAGE_PATH } from "./contacts.constants.ts";

export type ContactMember = {
  agentId: string;
  name: string;
};

export type Contact = {
  id: string;
  name: string;
  description: string;
  type: "individual" | "group";
  phone?: string;
  email?: string;
  members?: ContactMember[]; // only for type === "group"
};

export async function readContacts(context: Context, apiClient: Client): Promise<Contact[]> {
  try {
    const { data } = await storageDownloadFileAgent({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      query: { path: CONTACTS_STORAGE_PATH },
    });
    const url = (data as { download_url?: string })?.download_url;
    if (!url) return [];
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json() as Contact[];
  } catch {
    return [];
  }
}

export async function writeContacts(contacts: Contact[], context: Context, apiClient: Client): Promise<void> {
  const { data } = await storageUploadFileAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
    body: { path: CONTACTS_STORAGE_PATH, content_type: "application/json" },
  });
  if (!data?.upload_url) throw new Error("Failed to get signed upload URL for contacts.");
  const bytes = new TextEncoder().encode(JSON.stringify(contacts));
  await putToSignedUrl(data.upload_url, bytes, "application/json", data.max_size_bytes ?? 10485760);
}
