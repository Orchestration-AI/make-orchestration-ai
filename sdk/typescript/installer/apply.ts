// Apply engine.
//
// Walks the definition in dependency order, creating OAI resources via the
// generated SDK, resolving service logical names to ids, uploading files, and
// writing an install record to orchestration storage. Emits a progress event
// per resource and rolls back (including completed custom-step teardown) on
// failure.

import type { Client } from "../client";
import {
  orchestrationCreate,
  agentCreate,
  layerCreate,
  settingCreate,
  linkCreate,
  endpointCreate,
  taskCreate,
  serviceFind,
  workspaceCreate,
  orchestrationDeleteById,
} from "../sdk.gen";
import type {
  OrchestrationInstaller,
  AgentDef,
  AppliedResource,
  InstallRecord,
  SettingType,
} from "./define";
import { INSTALL_RECORD_PATH, computeSummary } from "./define";
import type { ResolvedSetting } from "./bridge";
import {
  uploadFile,
  deleteFile,
  defaultReadSource,
  type StorageScope,
} from "./files";
import { fetchAvailableLlms, resolveLlm, type AvailableLlm } from "./llm";

// --- Progress events ---

export type ProgressEvent =
  | { phase: "start"; total: number }
  | { phase: "resource"; kind: string; name: string; status: "creating" | "done" | "failed"; id?: string; error?: string }
  | { phase: "rollback"; kind: string; name: string; status: "deleting" | "done" | "failed" }
  | { phase: "hook"; name: string; status: "running" | "done" | "failed"; error?: string }
  | { phase: "complete"; record: InstallRecord }
  | { phase: "error"; message: string };

export type ProgressSink = (event: ProgressEvent) => void;

// --- Plan (dry run) ---

export type PlanItem = { kind: string; name: string };

/**
 * Produce the ordered list of resources that would be created, without any side
 * effects. Powers the review screen and a CLI --dry-run.
 */
export function plan(def: OrchestrationInstaller): { items: PlanItem[]; summary: ReturnType<typeof computeSummary> } {
  const items: PlanItem[] = [];
  const orch = def.orchestration;
  items.push({ kind: "orchestration", name: orch.orchestration_name });
  for (const f of orch.files ?? []) items.push({ kind: "file", name: `orchestration:${f.path}` });
  for (const agent of orch.agents ?? []) {
    items.push({ kind: "agent", name: agent.agent_name });
    for (const l of agent.layers ?? []) items.push({ kind: "layer", name: `${agent.agent_name}/${l.layer_name}` });
    for (const s of agent.settings ?? []) items.push({ kind: "setting", name: `${agent.agent_name}/${s.setting_name}` });
    for (const l of agent.links ?? []) items.push({ kind: "link", name: `${agent.agent_name}/${l.link_name}` });
    for (const e of agent.endpoints ?? []) items.push({ kind: "endpoint", name: `${agent.agent_name}${e.endpoint}` });
    for (const t of agent.tasks ?? []) items.push({ kind: "task", name: `${agent.agent_name}: ${t.message.slice(0, 24)}` });
    for (const f of agent.files ?? []) items.push({ kind: "file", name: `${agent.agent_name}:${f.path}` });
  }
  return { items, summary: computeSummary(def) };
}

// --- Apply ---

export type ApplyOptions = {
  client: Client;
  /** Existing workspace id, or omit and set `createWorkspaceName` to make one. */
  workspaceId?: string;
  createWorkspaceName?: string;
  /** Resolved setting values (defaults + review edits + custom-step outputs). */
  settings: ResolvedSetting[];
  /** Custom-step undo state captured during the wizard. */
  customStepUndo?: Array<{ id: string; undo_state: Record<string, unknown> }>;
  /** Teardown hook per step id, used on rollback (passed by the server). */
  runStepUninstall?: (
    stepId: string,
    undo_state: Record<string, unknown>,
    ctx: { workspaceId: string; orchestrationId: string }
  ) => Promise<void>;
  onProgress?: ProgressSink;
  /** File source reader; defaults to node:fs. Overridable for tests. */
  readSource?: (sourcePath: string) => Promise<Uint8Array>;
};

function settingValueFields(type: SettingType, value: string | boolean): {
  text_value: string;
  boolean_value: boolean;
} {
  if (type === "Boolean") return { text_value: "", boolean_value: Boolean(value) };
  return { text_value: String(value ?? ""), boolean_value: false };
}

/**
 * Validate a layer's referenced services against the services available to the
 * authenticated principal, returning their ids. A service's id is derived from
 * its unique_name (they are equal), so the logical names in the definition are
 * matched against service ids; this also confirms the service actually exists
 * in the selected workspace before we create the layer.
 */
async function resolveServiceIds(client: Client, logicalNames: string[]): Promise<string[]> {
  if (logicalNames.length === 0) return [];
  const { data, error } = await serviceFind({ client });
  if (error) throw new Error(`service lookup failed: ${JSON.stringify(error)}`);
  const services = data?.services ?? [];
  const byId = new Map(services.map((s) => [s.id, s.id]));
  const ids: string[] = [];
  for (const name of logicalNames) {
    const id = byId.get(name);
    if (!id) throw new Error(`service "${name}" not found in the selected workspace`);
    ids.push(id);
  }
  return ids;
}

/**
 * Apply the definition. Returns the install record on success; throws after a
 * best-effort rollback on failure.
 */
export async function apply(def: OrchestrationInstaller, opts: ApplyOptions): Promise<InstallRecord> {
  const { client, settings } = opts;
  const emit = opts.onProgress ?? (() => {});
  const readSource = opts.readSource ?? defaultReadSource;

  const applied: AppliedResource[] = [];
  const { items } = plan(def);
  emit({ phase: "start", total: items.length });

  // Resolve workspace up front.
  let workspaceId = opts.workspaceId;
  if (!workspaceId) {
    if (!opts.createWorkspaceName) {
      throw new Error("either workspaceId or createWorkspaceName is required");
    }
    const { data, error } = await workspaceCreate({ client, body: { workspace_name: opts.createWorkspaceName } });
    if (error || !data?.id) throw new Error(`workspace create failed: ${JSON.stringify(error)}`);
    workspaceId = data.id;
  }
  const wsId: string = workspaceId;

  // Track which custom steps completed, for rollback teardown.
  const completedSteps = opts.customStepUndo ?? [];

  const rollback = async () => {
    // Teardown third-party side effects first.
    if (opts.runStepUninstall) {
      for (const step of completedSteps) {
        try {
          await opts.runStepUninstall(step.id, step.undo_state, {
            workspaceId: wsId,
            orchestrationId: orchestrationId ?? "",
          });
        } catch {
          /* best-effort */
        }
      }
    }
    // Deleting the orchestration cascades to its children, so a single delete
    // (if it was created) is sufficient. Fall back to no-op otherwise.
    if (orchestrationId) {
      emit({ phase: "rollback", kind: "orchestration", name: def.orchestration.orchestration_name, status: "deleting" });
      try {
        await orchestrationDeleteById({ client, path: { workspaceId: wsId, id: orchestrationId } });
        emit({ phase: "rollback", kind: "orchestration", name: def.orchestration.orchestration_name, status: "done" });
      } catch {
        emit({ phase: "rollback", kind: "orchestration", name: def.orchestration.orchestration_name, status: "failed" });
      }
    }
  };

  let orchestrationId: string | undefined;

  try {
    const orch = def.orchestration;

    // 1. Orchestration
    emit({ phase: "resource", kind: "orchestration", name: orch.orchestration_name, status: "creating" });
    {
      const { data, error } = await orchestrationCreate({
        client,
        path: { workspaceId: wsId },
        body: {
          orchestration_name: orch.orchestration_name,
          orchestration_description: orch.orchestration_description,
        },
      });
      if (error || !data?.id) throw new Error(`orchestration create failed: ${JSON.stringify(error)}`);
      orchestrationId = data.id;
      applied.push({ kind: "orchestration", id: data.id });
      emit({ phase: "resource", kind: "orchestration", name: orch.orchestration_name, status: "done", id: data.id });
    }
    const oId: string = orchestrationId;

    // 2. Orchestration-scoped files
    const orchScope: StorageScope = { scope: "orchestration", workspaceId: wsId, orchestrationId: oId };
    for (const file of orch.files ?? []) {
      emit({ phase: "resource", kind: "file", name: `orchestration:${file.path}`, status: "creating" });
      await uploadFile(client, orchScope, file, readSource);
      applied.push({ kind: "file", scope: "orchestration", path: file.path });
      emit({ phase: "resource", kind: "file", name: `orchestration:${file.path}`, status: "done" });
    }

    // 3. Agents and their children
    // Fetch the user's available LLMs once so layer llm_name references can be
    // resolved (with fallback) to ids. Best-effort: if the lookup fails we
    // proceed with an empty list, which forces the platform fallback.
    let availableLlms: AvailableLlm[] = [];
    try {
      availableLlms = await fetchAvailableLlms(client);
    } catch {
      availableLlms = [];
    }
    for (const agent of orch.agents ?? []) {
      await applyAgent(client, wsId, oId, agent, settings, applied, emit, readSource, availableLlms);
    }

    // 4. Install record
    const record: InstallRecord = {
      installer_name: def.installer_name,
      installer_version: def.installer_version,
      workspace_id: wsId,
      orchestration_id: oId,
      installed_at: new Date().toISOString(),
      applied,
      custom_steps: completedSteps,
    };
    await uploadFile(
      client,
      orchScope,
      { path: INSTALL_RECORD_PATH, content: JSON.stringify(record, null, 2), content_type: "application/json" },
      readSource
    );

    // Installer-level post-install hook. Non-fatal: a failure here is reported
    // but does NOT roll back a successful installation.
    if (def.onInstalled) {
      emit({ phase: "hook", name: "onInstalled", status: "running" });
      try {
        await def.onInstalled({
          apiClient: client,
          workspaceId: wsId,
          orchestrationId: oId,
          record,
          settings: settings.map((s) => ({
            agent_name: s.agent_name,
            setting_name: s.setting_name,
            setting_type: s.setting_type,
            value: s.value,
          })),
        });
        emit({ phase: "hook", name: "onInstalled", status: "done" });
      } catch (hookErr) {
        emit({ phase: "hook", name: "onInstalled", status: "failed", error: hookErr instanceof Error ? hookErr.message : String(hookErr) });
      }
    }

    emit({ phase: "complete", record });
    return record;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ phase: "error", message });
    await rollback();
    throw new Error(`install failed and was rolled back: ${message}`);
  }
}

async function applyAgent(
  client: Client,
  workspaceId: string,
  orchestrationId: string,
  agent: AgentDef,
  settings: ResolvedSetting[],
  applied: AppliedResource[],
  emit: ProgressSink,
  readSource: (p: string) => Promise<Uint8Array>,
  availableLlms: AvailableLlm[]
): Promise<string> {
  emit({ phase: "resource", kind: "agent", name: agent.agent_name, status: "creating" });
  const { data, error } = await agentCreate({
    client,
    path: { workspaceId, orchestrationId },
    body: {
      agent_name: agent.agent_name,
      agent_description: agent.agent_description,
      vm_enabled: agent.vm_enabled ?? false,
      ...(agent.script ? { script: agent.script } : {}),
    },
  });
  if (error || !data?.id) throw new Error(`agent "${agent.agent_name}" create failed: ${JSON.stringify(error)}`);
  const agentId = data.id;
  applied.push({ kind: "agent", id: agentId });
  emit({ phase: "resource", kind: "agent", name: agent.agent_name, status: "done", id: agentId });

  // Layers
  for (const layer of agent.layers ?? []) {
    const name = `${agent.agent_name}/${layer.layer_name}`;
    emit({ phase: "resource", kind: "layer", name, status: "creating" });
    const serviceIds = await resolveServiceIds(client, layer.services ?? []);
    const llm = resolveLlm(layer.llm_name, layer.fallback_llm_name, availableLlms);
    const { data: ld, error: le } = await layerCreate({
      client,
      path: { workspaceId, orchestrationId, agentId },
      body: {
        layer_name: layer.layer_name,
        ...(layer.context_md != null ? { context_md: layer.context_md } : {}),
        ...(layer.temperature != null ? { temperature: layer.temperature } : {}),
        ...(llm && llm.id ? { llm: { id: llm.id } } : {}),
        ...(serviceIds.length ? { services: serviceIds.map((id) => ({ id })) } : {}),
      },
    });
    if (le || !ld?.id) throw new Error(`layer "${name}" create failed: ${JSON.stringify(le)}`);
    applied.push({ kind: "layer", agent_id: agentId, id: ld.id });
    emit({ phase: "resource", kind: "layer", name, status: "done", id: ld.id });
  }

  // Settings — merge resolved values for this agent.
  const agentSettings = settings.filter((s) => s.agent_name === agent.agent_name);
  for (const s of agentSettings) {
    const name = `${agent.agent_name}/${s.setting_name}`;
    emit({ phase: "resource", kind: "setting", name, status: "creating" });
    const { text_value, boolean_value } = settingValueFields(s.setting_type, s.value);
    const { data: sd, error: se } = await settingCreate({
      client,
      path: { workspaceId, orchestrationId, agentId },
      body: {
        setting_name: s.setting_name,
        setting_description: s.setting_description,
        setting_type: s.setting_type,
        text_value,
        boolean_value,
      },
    });
    if (se || !sd?.id) throw new Error(`setting "${name}" create failed: ${JSON.stringify(se)}`);
    applied.push({ kind: "setting", agent_id: agentId, id: sd.id });
    emit({ phase: "resource", kind: "setting", name, status: "done", id: sd.id });
  }

  // Links
  for (const link of agent.links ?? []) {
    const name = `${agent.agent_name}/${link.link_name}`;
    emit({ phase: "resource", kind: "link", name, status: "creating" });
    const { data: kd, error: ke } = await linkCreate({
      client,
      path: { workspaceId, orchestrationId, agentId },
      body: { link_name: link.link_name, link_description: link.link_description, link_url: link.link_url },
    });
    if (ke || !kd?.id) throw new Error(`link "${name}" create failed: ${JSON.stringify(ke)}`);
    applied.push({ kind: "link", agent_id: agentId, id: kd.id });
    emit({ phase: "resource", kind: "link", name, status: "done", id: kd.id });
  }

  // Endpoints
  for (const ep of agent.endpoints ?? []) {
    const name = `${agent.agent_name}${ep.endpoint}`;
    emit({ phase: "resource", kind: "endpoint", name, status: "creating" });
    const { data: ed, error: ee } = await endpointCreate({
      client,
      path: { workspaceId, orchestrationId, agentId },
      body: { description: ep.description, endpoint: ep.endpoint },
    });
    if (ee || !ed?.id) throw new Error(`endpoint "${name}" create failed: ${JSON.stringify(ee)}`);
    applied.push({ kind: "endpoint", agent_id: agentId, id: ed.id });
    emit({ phase: "resource", kind: "endpoint", name, status: "done", id: ed.id });
  }

  // Tasks
  for (const task of agent.tasks ?? []) {
    const name = `${agent.agent_name}: ${task.message.slice(0, 24)}`;
    emit({ phase: "resource", kind: "task", name, status: "creating" });
    const { data: td, error: te } = await taskCreate({
      client,
      path: { workspaceId, orchestrationId, agentId },
      body: {
        message: task.message,
        ...(task.cron_expression ? { cron_expression: task.cron_expression } : {}),
        ...(task.value_date ? { value_date: task.value_date } : {}),
        ...(task.session_id ? { session_id: task.session_id } : {}),
      },
    });
    if (te || !td?.id) throw new Error(`task "${name}" create failed: ${JSON.stringify(te)}`);
    applied.push({ kind: "task", agent_id: agentId, id: td.id });
    emit({ phase: "resource", kind: "task", name, status: "done", id: td.id });
  }

  // Agent-scoped files
  const agentScope: StorageScope = { scope: "agent", workspaceId, orchestrationId, agentId };
  for (const file of agent.files ?? []) {
    const name = `${agent.agent_name}:${file.path}`;
    emit({ phase: "resource", kind: "file", name, status: "creating" });
    await uploadFile(client, agentScope, file, readSource);
    applied.push({ kind: "file", scope: "agent", agent_id: agentId, path: file.path });
    emit({ phase: "resource", kind: "file", name, status: "done" });
  }

  return agentId;
}

// Re-export for the server/uninstall module.
export { deleteFile };
