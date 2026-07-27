import type { Context } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { taskCreate, agentFindById, settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import type { Setting } from "@orchestration-ai/sdk/services";
import { sendMessages, getBooleanSetting } from "@orchestration-ai/sdk/services";
import { readContacts, writeContacts } from "./contacts.storage.ts";
import type { Contact, ContactMember } from "./contacts.storage.ts";
import { asyncMessagingSettingKey } from "./contacts.constants.ts";

function crypto_uuid(): string {
  return crypto.randomUUID();
}

function asyncMessagingEnabled(settings: Setting[]): boolean {
  return getBooleanSetting(settings, asyncMessagingSettingKey);
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listContacts(
  _body: Record<never, never>,
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  const contacts = await readContacts(context, apiClient);
  return { contacts };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createContact(
  body: Omit<Contact, "id"> & { id?: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  const contacts = await readContacts(context, apiClient);
  const id = body.id ?? crypto_uuid();
  if (contacts.find((c) => c.id === id)) {
    return { error: `A contact with id '${id}' already exists.` };
  }
  const contact: Contact = {
    id,
    name: body.name,
    description: body.description,
    type: body.type,
    ...(body.phone ? { phone: body.phone } : {}),
    ...(body.email ? { email: body.email } : {}),
    ...(body.type === "group" && body.members ? { members: body.members } : {}),
  };
  contacts.push(contact);
  await writeContacts(contacts, context, apiClient);
  return { contact };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateContact(
  body: Partial<Omit<Contact, "id">> & { id: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  const contacts = await readContacts(context, apiClient);
  const idx = contacts.findIndex((c) => c.id === body.id);
  if (idx === -1) {
    return { error: `No contact found with id '${body.id}'. Use list_contacts to see available contacts.` };
  }
  contacts[idx] = { ...contacts[idx], ...body };
  await writeContacts(contacts, context, apiClient);
  return { contact: contacts[idx] };
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteContact(
  body: { id: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  const contacts = await readContacts(context, apiClient);
  const idx = contacts.findIndex((c) => c.id === body.id);
  if (idx === -1) {
    return { error: `No contact found with id '${body.id}'. Use list_contacts to see available contacts.` };
  }
  contacts.splice(idx, 1);
  await writeContacts(contacts, context, apiClient);
  return { success: true };
}

// ── Message contact ───────────────────────────────────────────────────────────

export async function messageContact(
  body: { id: string; message: string },
  context: Context,
  engineClient: Client,
  apiClient: Client,
) {
  const contacts = await readContacts(context, apiClient);
  const contact = contacts.find((c) => c.id === body.id);

  if (!contact) {
    return { error: `No contact found with id '${body.id}'. Use list_contacts to see available contacts.` };
  }
  if (contact.type === "group") {
    return { error: `'${contact.name}' is a group contact. Use message_group instead.` };
  }

  // For individual contacts, the id IS the agentId only if it was created via agent selection.
  // We detect non-agent contacts by checking if the id looks like a UUID not tied to an agent.
  // The reliable signal: try to resolve the agent. If it fails, it's a human contact.
  try {
    const { data: agentData } = await agentFindById({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        id: contact.id,
      },
    });
    if (!agentData?.id) throw new Error("not found");

    const fullMessage = `[From: ${context.identity.agentName ?? "Unknown"} (${context.identity.agentId})]\n\n${body.message}`;

    const { data: settings } = await settingFindByAgent({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
    });
    const isAsync = asyncMessagingEnabled((settings?.settings ?? []) as Setting[]);

    if (isAsync) {
      const orchestrationId = agentData.orchestration?.id ?? context.identity.orchestrationId;
      const workspaceId = agentData.orchestration?.workspace?.id ?? context.identity.workspaceId;
      await taskCreate({
        client: apiClient,
        path: { workspaceId, orchestrationId, agentId: contact.id },
        body: { message: fullMessage },
      });
      return { success: true, delivered: "async" };
    } else {
      await sendMessages(contact.id, 0, [{ message: fullMessage }], context.identity.layerId, engineClient);
      return { success: true, delivered: "direct" };
    }
  } catch {
    // Not an agent - build a helpful error
    const channels: string[] = [];
    if (contact.email) channels.push("an email address - use an email service to reach them");
    if (contact.phone) channels.push("a phone number - use a phone, SMS, or messaging service to reach them");

    if (channels.length === 0) {
      return {
        error: `'${contact.name}' is not an agent contact and has no email or phone number on record. Update the contact with the correct details.`,
      };
    }
    return {
      error: `'${contact.name}' is not an agent contact and cannot receive direct messages. They have ${channels.join(" and ")} instead.`,
    };
  }
}

// ── Message group ─────────────────────────────────────────────────────────────

export async function messageGroup(
  body: { id: string; message: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
) {
  const contacts = await readContacts(context, apiClient);
  const contact = contacts.find((c) => c.id === body.id);

  if (!contact) {
    return { error: `No contact found with id '${body.id}'. Use list_contacts to see available contacts.` };
  }
  if (contact.type !== "group") {
    return { error: `'${contact.name}' is an individual contact, not a group. Use message_contact instead.` };
  }
  if (!contact.members || contact.members.length === 0) {
    return { error: `The group '${contact.name}' has no members. Update the contact to add agent members before messaging.` };
  }

  const fullMessage = `[From: ${context.identity.agentName ?? "Unknown"} (${context.identity.agentId})]\n\n${body.message}`;
  const results = await Promise.allSettled(
    contact.members.map((member: ContactMember) =>
      taskCreate({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: member.agentId,
        },
        body: { message: fullMessage },
      })
    )
  );

  const failed = contact.members.filter((_, i) => results[i].status === "rejected");
  if (failed.length === 0) {
    return { success: true, delivered: contact.members.length };
  }
  const failedNames = failed.map((m) => m.name).join(", ");
  return {
    success: true,
    delivered: contact.members.length - failed.length,
    total: contact.members.length,
    warning: `Message delivered to ${contact.members.length - failed.length}/${contact.members.length} members. The following members could not be reached: ${failedNames}. Their contact entries may have stale agent ids.`,
  };
}
