import { getContext } from "../context.middleware.ts";
import { createApiClient } from "@orchestration-ai/sdk/services";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { authDecryptPasskey, agentFindByOrchestration } from "@orchestration-ai/sdk/sdk.gen";
import { getRequiredEnvValue } from "../environment.ts";
import { readContacts, writeContacts } from "./contacts.storage.ts";
import type { Contact } from "./contacts.storage.ts";
// @deno-types="npm:@types/express@5.0.0"
import type { Request, Response } from "express";

function makeApiClient(workspaceOwnerId: string) {
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const clientId = getRequiredEnvValue("OAI_CLIENT_ID");
  const apiClient = createApiClient();
  setupClientCredentials(apiClient, {
    client_secret: accessKey,
    client_id: `${clientId}:${workspaceOwnerId}`,
  });
  return apiClient;
}

async function resolveContext(passkey: string) {
  const anonClient = createApiClient();
  const { data: decrypted } = await authDecryptPasskey({ body: { passkey }, client: anonClient });
  const layerId = decrypted?.data as string;
  if (!layerId) throw new Error("Invalid passkey");
  const context = await getContext(layerId);
  const apiClient = makeApiClient(context.identity.workspaceOwnerId);
  return { context, apiClient };
}

// GET /services/contacts/config/api/init
export async function handleContactsInit(req: Request, res: Response): Promise<void> {
  try {
    const passkey = req.query.passkey as string;
    if (!passkey) { res.status(400).send("Missing passkey"); return; }
    const { context, apiClient } = await resolveContext(passkey);
    const contacts = await readContacts(context, apiClient);
    res.json({ contacts });
  } catch (err) {
    console.error("[contacts:config] Init error:", err);
    res.status(500).send("Init failed");
  }
}

// GET /services/contacts/config/api/agents
export async function handleContactsAgents(req: Request, res: Response): Promise<void> {
  try {
    const passkey = req.query.passkey as string;
    if (!passkey) { res.status(400).send("Missing passkey"); return; }
    const { context, apiClient } = await resolveContext(passkey);
    const { data } = await agentFindByOrchestration({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
      },
    });
    const agents = (data?.agents ?? []).map((a: { id?: string; agent_name?: string }) => ({
      id: a.id,
      name: a.agent_name,
    }));
    res.json({ agents });
  } catch (err) {
    console.error("[contacts:config] Agents error:", err);
    res.status(500).send("Failed to load agents");
  }
}

// POST /services/contacts/config/api/save
export async function handleContactsSave(req: Request, res: Response): Promise<void> {
  try {
    const passkey = req.body?.passkey as string;
    if (!passkey) { res.status(400).send("Missing passkey"); return; }
    const contacts = req.body?.contacts as Contact[];
    if (!Array.isArray(contacts)) { res.status(400).send("Invalid contacts payload"); return; }
    const { context, apiClient } = await resolveContext(passkey);
    await writeContacts(contacts, context, apiClient);
    res.json({ success: true });
  } catch (err) {
    console.error("[contacts:config] Save error:", err);
    res.status(500).json({ success: false, error: `${err}` });
  }
}
