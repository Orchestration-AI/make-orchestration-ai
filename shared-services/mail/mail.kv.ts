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
  // Also clear any processed-thread records for this agent so KV doesn't leak.
  const iter = kv.list({ prefix: ["mail_processed", agentId] });
  for await (const entry of iter) {
    await kv.delete(entry.key);
  }
}

export async function listMailAgents(): Promise<MailAgentIdentity[]> {
  const agents: MailAgentIdentity[] = [];
  const iter = kv.list<MailAgentIdentity>({ prefix: ["mail_agent"] });
  for await (const entry of iter) {
    agents.push(entry.value);
  }
  return agents;
}

// --- Processed-thread tracking -------------------------------------------------
// We track which threads an agent has already processed in our own KV store so
// that read-state does not depend solely on the mutable server-side IMAP \Seen
// flag (which can be flipped back by humans/other clients or fail to be set).
//
// The record stores the messageCount at the time of processing. A thread is
// considered "already processed" only if the current messageCount is not greater
// than the recorded one, so genuinely new replies (higher messageCount) correctly
// re-surface the thread.

export type ProcessedThread = {
  messageCount: number;
  processedAt: string;
};

// Records expire so the store never grows unbounded.
const PROCESSED_THREAD_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export async function markThreadProcessed(
  agentId: string,
  threadId: string,
  messageCount: number,
): Promise<void> {
  const record: ProcessedThread = {
    messageCount,
    processedAt: new Date().toISOString(),
  };
  await kv.set(["mail_processed", agentId, threadId], record, {
    expireIn: PROCESSED_THREAD_TTL_MS,
  });
}

export async function getProcessedThread(
  agentId: string,
  threadId: string,
): Promise<ProcessedThread | null> {
  const entry = await kv.get<ProcessedThread>(["mail_processed", agentId, threadId]);
  return entry.value;
}

// A thread is already processed if we have a record whose messageCount is >= the
// current messageCount (i.e. no new messages have arrived since we processed it).
export async function isThreadAlreadyProcessed(
  agentId: string,
  threadId: string,
  currentMessageCount: number,
): Promise<boolean> {
  const record = await getProcessedThread(agentId, threadId);
  if (!record) return false;
  return currentMessageCount <= record.messageCount;
}
