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

// --- Processed-thread tracking (poll-side) -------------------------------------
// The mail poll is the single place that decides whether a thread has been
// handled. When it sees an unseen thread it enqueues a ticker task and records
// the thread here so subsequent polls ignore it.
//
// Change detection uses the latest IMAP INTERNALDATE seen for the thread rather
// than a message count. INTERNALDATE is the server's receipt time, assigned on
// arrival, so any new reply carries a timestamp >= the newest message we've
// already processed — even when threading collapses replies into a single visible
// message (which made messageCount unreliable, since FETCH_UNSEEN only counts
// currently-unseen messages and resets after a thread is marked seen).

export type ProcessedThread = {
  lastInternalDate: string;
  processedAt: string;
};

// Records expire so the store never grows unbounded.
const PROCESSED_THREAD_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export async function markThreadProcessed(
  agentId: string,
  threadId: string,
  lastInternalDate: string,
): Promise<void> {
  const record: ProcessedThread = {
    lastInternalDate,
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

// A thread is already processed if we have a record whose lastInternalDate is >=
// the current one (i.e. no message newer than what we processed has arrived). ISO
// 8601 UTC strings compare lexicographically in chronological order, so a plain
// string comparison is a valid time comparison.
export async function isThreadAlreadyProcessed(
  agentId: string,
  threadId: string,
  currentLastInternalDate: string,
): Promise<boolean> {
  const record = await getProcessedThread(agentId, threadId);
  if (!record) return false;
  return currentLastInternalDate <= record.lastInternalDate;
}
