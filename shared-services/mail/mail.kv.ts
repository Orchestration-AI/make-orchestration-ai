const kv = await Deno.openKv();

export type MailAgentIdentity = {
  workspaceId: string;
  orchestrationId: string;
  agentId: string;
  workspaceOwnerId: string;
  layerId: string;
};

export async function registerMailAgent(identity: MailAgentIdentity): Promise<void> {
  await kv.set(["mail_agent", identity.agentId], identity);
}

export async function unregisterMailAgent(agentId: string): Promise<void> {
  await kv.delete(["mail_agent", agentId]);
}

export async function listMailAgents(): Promise<MailAgentIdentity[]> {
  const agents: MailAgentIdentity[] = [];
  const iter = kv.list<MailAgentIdentity>({ prefix: ["mail_agent"] });
  for await (const entry of iter) {
    agents.push(entry.value);
  }
  return agents;
}
