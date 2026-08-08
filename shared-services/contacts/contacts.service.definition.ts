import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { linkCreate } from "@orchestration-ai/sdk/sdk.gen";
import { defaultSettings, CONTACTS_SERVICE_UNIQUE_NAME } from "./contacts.constants.ts";
import { getContactsDescription } from "./contacts.description.ts";
import { listContacts, createContact, updateContact, deleteContact, messageContact, messageGroup } from "./contacts.service.ts";
import process from "node:process";

export const contactsService = defineServiceWithDynamicDescription({
  unique_name: CONTACTS_SERVICE_UNIQUE_NAME,
  service_name: "OAI Contacts",
  service_description: "Manage and message agent contacts and groups.",
  defaultSettings,
  description: getContactsDescription,
  touch: async (context: Context, _engineClient: Client, apiClient: Client) => {
    await linkCreate({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      body: {
        link_name: "Contacts Manager",
        link_description: "Manage contacts for this agent.",
        link_url: `${process.env.SELF_PUBLIC_URL}/services/contacts/config`,
      },
    });
  },
  tools: {
    list_contacts: (body: Record<never, never>, context: Context, engineClient: Client, apiClient: Client) =>
      listContacts(body, context, engineClient, apiClient),
    create_contact: (body: Parameters<typeof createContact>[0], context: Context, engineClient: Client, apiClient: Client) =>
      createContact(body, context, engineClient, apiClient),
    update_contact: (body: Parameters<typeof updateContact>[0], context: Context, engineClient: Client, apiClient: Client) =>
      updateContact(body, context, engineClient, apiClient),
    delete_contact: (body: { id: string }, context: Context, engineClient: Client, apiClient: Client) =>
      deleteContact(body, context, engineClient, apiClient),
    message_contact: (body: { id: string; message: string }, context: Context, engineClient: Client, apiClient: Client) =>
      messageContact(body, context, engineClient, apiClient),
    message_group: (body: { id: string; message: string }, context: Context, engineClient: Client, apiClient: Client) =>
      messageGroup(body, context, engineClient, apiClient),
  },
});
