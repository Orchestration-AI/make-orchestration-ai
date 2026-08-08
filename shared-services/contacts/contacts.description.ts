import type { Context, ServiceDescription } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import type { Setting } from "@orchestration-ai/sdk/services";
import { CAN_MODIFY_CONTACTS_KEY } from "./contacts.constants.ts";

function canModify(settings: Setting[]): boolean {
  const s = settings.find((s) => s.setting_name === CAN_MODIFY_CONTACTS_KEY);
  return s?.setting_type === "Boolean" ? (s.boolean_value ?? false) : false;
}

export async function getContactsDescription(
  context: Context,
  _engineClient: Client,
  apiClient: Client,
): Promise<ServiceDescription> {
  const { data } = await settingFindByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
  });
  const modify = canModify((data?.settings ?? []) as Setting[]);

  const contactParams = {
    name: { type: "string" as const, optional: false, description: "Full name of the contact." },
    description: { type: "string" as const, optional: false, description: "Description of who this contact is." },
    type: { type: "string" as const, optional: false, description: "Contact type: 'individual' or 'group'." },
    phone: { type: "string" as const, optional: true, description: "Phone number." },
    email: { type: "string" as const, optional: true, description: "Email address." },
    id: { type: "string" as const, optional: true, description: "For individual agent contacts: the target agent's id (this becomes the contact id). For groups or human contacts: omit to auto-generate." },
    members: { type: "string" as const, optional: true, description: "JSON array of {agentId, name} objects. Only for type 'group'." },
  };

  return [
    {
      path: "list_contacts",
      method: "POST",
      description: "Part of OAI Contacts. Returns the full list of contacts for this agent.",
      parameters: {},
    },
    ...(modify ? [
      {
        path: "create_contact" as const,
        method: "POST" as const,
        description: "Part of OAI Contacts. Creates a new contact.",
        parameters: contactParams,
      },
      {
        path: "update_contact" as const,
        method: "POST" as const,
        description: "Part of OAI Contacts. Updates an existing contact by id.",
        parameters: {
          id: { type: "string" as const, optional: false, description: "Id of the contact to update." },
          name: { type: "string" as const, optional: true, description: "Updated name." },
          description: { type: "string" as const, optional: true, description: "Updated description." },
          phone: { type: "string" as const, optional: true, description: "Updated phone number." },
          email: { type: "string" as const, optional: true, description: "Updated email address." },
          members: { type: "string" as const, optional: true, description: "Updated JSON array of {agentId, name} objects. Only for group contacts." },
        },
      },
      {
        path: "delete_contact" as const,
        method: "POST" as const,
        description: "Part of OAI Contacts. Permanently deletes a contact by id.",
        parameters: {
          id: { type: "string" as const, optional: false, description: "Id of the contact to delete." },
        },
      },
    ] : []),
    {
      path: "message_contact",
      method: "POST",
      description: "Part of OAI Contacts. Sends a message to an individual contact that is an agent. The sender's name and id are automatically included. Returns an error with alternative suggestions if the contact is not an agent.",
      parameters: {
        id: { type: "string" as const, optional: false, description: "Id of the contact to message." },
        message: { type: "string" as const, optional: false, description: "The message to send." },
      },
    },
    {
      path: "message_group",
      method: "POST",
      description: "Part of OAI Contacts. Sends a message to all agent members of a group contact via ticker tasks. The sender's name and id are automatically included. Always async regardless of ASYNC_MESSAGING setting.",
      parameters: {
        id: { type: "string" as const, optional: false, description: "Id of the group contact to message." },
        message: { type: "string" as const, optional: false, description: "The message to send to all group members." },
      },
    },
  ];
}
