// Orchestration Installer — definition format.
//
// Developers declare a full orchestration (workspace-scoped: orchestration ->
// agents -> layers/settings/links/endpoints/tasks, plus OAI files at
// orchestration and agent scope) in a typed, JSON-like object. The field names
// mirror the REST API bodies the SDK generates, so the apply engine is a thin
// typed walker over the generated `*Create` functions.
//
// The workspace is NOT part of the definition — it is chosen by the end user at
// install time (select existing or create new).

import type { Client } from "../client";

// --- Setting ---

/**
 * A single agent-scoped setting. `default` seeds the value shown (and editable)
 * on the review screen; the user's confirmed value overrides it before apply.
 * Secrets use `setting_type: "Secret"` and are stored write-only in the API.
 */
export type SettingType = "Text" | "Boolean" | "Secret";

export type SettingDef = {
  setting_name: string;
  setting_description: string;
  setting_type: SettingType;
  /** Default value. string for Text/Secret, boolean for Boolean. */
  default?: string | boolean;
  /** If true, the user cannot edit this on the review screen. */
  locked?: boolean;
};

// --- Layer ---

export type LayerDef = {
  layer_name: string;
  context_md?: string;
  temperature?: number;
  /**
   * Preferred LLM for this layer, referenced by name (e.g. "claude-sonnet-5"
   * or "gemini-2.5-pro:oai"). Resolved to an id against the user's available
   * LLMs at apply time. If the user doesn't have it, the fallback chain applies:
   * `fallback_llm_name` (if set) -> the guaranteed platform LLM
   * (`gemini-2.5-flash:oai`). If omitted entirely, the platform LLM is used
   * (the layer always ends up with a guaranteed model).
   */
  llm_name?: string;
  /**
   * Developer-chosen fallback LLM name, used when the user doesn't have
   * `llm_name`. Pick one the user is guaranteed to have (see GUARANTEED_LLMS)
   * if you don't want the installer's own fallback. If this is also
   * unavailable, the platform fallback (`gemini-2.5-flash:oai`) is used.
   */
  fallback_llm_name?: string;
  /**
   * Services to attach, referenced by their logical unique_name
   * (e.g. "messaging", "mail"). Resolved to service ids via serviceFind at
   * apply time, since ids differ per environment.
   */
  services?: string[];
};

// --- Link / Endpoint / Task ---

export type LinkDef = {
  link_name: string;
  link_description: string;
  link_url: string;
};

export type EndpointDef = {
  description: string;
  endpoint: string;
};

export type TaskDef = {
  message: string;
  cron_expression?: string;
  value_date?: string;
  session_id?: string;
};

// --- Files (OAI storage) ---

/**
 * An OAI file to upload at orchestration or agent scope. Exactly one of
 * `content` (inline text) or `source` (path to a bundled file, incl. binary
 * like PDF) must be set — mirrors the Terraform storage_file resource.
 */
export type FileDef = {
  /** Destination path within the storage scope, e.g. "config/defaults.json". */
  path: string;
  /** Inline text content. Mutually exclusive with `source`. */
  content?: string;
  /** Path to a local bundled file to upload. Mutually exclusive with `content`. */
  source?: string;
  /** Override the content type. Inferred from the extension when omitted. */
  content_type?: string;
};

// --- Agent ---

export type AgentScriptDef = {
  source?: string;
  packageJson?: string;
};

export type AgentDef = {
  agent_name: string;
  agent_description: string;
  vm_enabled?: boolean;
  script?: AgentScriptDef;
  layers?: LayerDef[];
  settings?: SettingDef[];
  links?: LinkDef[];
  endpoints?: EndpointDef[];
  tasks?: TaskDef[];
  /** OAI files uploaded at this agent's scope. */
  files?: FileDef[];
};

// --- Orchestration ---

export type OrchestrationDef = {
  orchestration_name: string;
  orchestration_description: string;
  /** OAI files uploaded at orchestration scope. */
  files?: FileDef[];
  agents?: AgentDef[];
};

// --- Custom steps ---

/**
 * The result a custom step emits via the postMessage bridge during install.
 * `settings` are merged into the target agent's settings; `undo_state` is
 * persisted in the install record and handed back to the step's `uninstall`
 * hook so third-party side effects can be torn down.
 */
export type CustomStepResult = {
  /** Settings to add, targeted at an agent by name. */
  settings?: Array<{
    agent_name: string;
    setting_name: string;
    setting_description?: string;
    setting_type: SettingType;
    value: string | boolean;
  }>;
  /** Opaque state the developer needs to undo third-party effects later. */
  undo_state?: Record<string, unknown>;
};

/**
 * Context passed to a custom step's `uninstall` hook. The developer receives an
 * authenticated API client and the `undo_state` they stored during install.
 */
export type CustomStepUninstallContext = {
  apiClient: Client;
  workspaceId: string;
  orchestrationId: string;
  undo_state: Record<string, unknown>;
};

export type CustomStepRouteHandler = (
  req: import("express").Request,
  res: import("express").Response
) => void | Promise<void>;

export type CustomStepDef = {
  id: string;
  title: string;
  description_md?: string;
  /** Inline HTML, or a path to an .html file bundled alongside the definition. */
  html: string;
  /**
   * Optional server-side routes this step hosts (e.g. a third-party OAuth
   * callback). Keyed by "METHOD /path"; mounted under the step's namespace.
   */
  routes?: Record<string, CustomStepRouteHandler>;
  /**
   * Teardown hook invoked during uninstall (and during rollback if this step
   * completed) to remove third-party side effects created by the step.
   */
  uninstall?: (ctx: CustomStepUninstallContext) => void | Promise<void>;
};

// --- Landing-page / publisher metadata ---

export type PublisherInfo = {
  name: string;
  url?: string;
  logo_url?: string;
};

export type InstallSummary = {
  agents?: number;
  layers?: number;
  settings?: number;
  files?: number;
  custom_steps?: number;
};

// --- Installer lifecycle hooks ---

/**
 * A resolved agent-scoped setting value, as applied. Passed to lifecycle hooks
 * so they can read configured values (e.g. a client email) to ping third-party
 * systems. Secret values are included — hooks run server-side only.
 */
export type AppliedSetting = {
  agent_name: string;
  setting_name: string;
  setting_type: SettingType;
  value: string | boolean;
};

/**
 * Context passed to the installer-level `onInstalled` hook, which fires once
 * after a successful install. Use it to ping third-party systems — e.g. send a
 * greeting email to the client.
 */
export type PostInstallContext = {
  apiClient: Client;
  workspaceId: string;
  orchestrationId: string;
  /** The persisted install record (ids + applied manifest + custom-step state). */
  record: InstallRecord;
  /** Resolved agent-scoped settings applied during install. */
  settings: AppliedSetting[];
};

/**
 * Context passed to the installer-level `onUninstalled` hook, which fires once
 * after a successful uninstall (after custom-step teardown + resource removal).
 */
export type PostUninstallContext = {
  apiClient: Client;
  workspaceId: string;
  orchestrationId: string;
  /** The install record that was torn down. */
  record: InstallRecord;
};

export type PostInstallHandler = (ctx: PostInstallContext) => void | Promise<void>;
export type PostUninstallHandler = (ctx: PostUninstallContext) => void | Promise<void>;

// --- The full definition ---

export type OrchestrationInstaller = {
  /** Human-readable installer name, shown on the landing page and consent screen. */
  installer_name: string;
  installer_version: string;
  publisher?: PublisherInfo;
  tagline?: string;
  /** Markdown rendered on the landing page. */
  description_md?: string;
  screenshots?: string[];
  highlights?: string[];
  /** OAuth scope requested. Defaults to "role_admin". */
  required_scope?: string;
  /** Optional precomputed counts for the landing page; computed if omitted. */
  install_summary?: InstallSummary;

  orchestration: OrchestrationDef;
  customSteps?: CustomStepDef[];

  /**
   * Fires once after a successful install. Use to ping third-party systems,
   * e.g. send a greeting email. Errors here do NOT roll back the install; they
   * are reported but the installation stands.
   */
  onInstalled?: PostInstallHandler;
  /**
   * Fires once after a successful uninstall (after custom-step teardown and
   * resource removal). Use to notify third-party systems of removal.
   */
  onUninstalled?: PostUninstallHandler;
};

// --- Install record ---
// Persisted to orchestration storage as `.installer-state.json` so uninstall
// can run custom-step teardown and reverse-delete OAI resources.

export type AppliedResource =
  | { kind: "orchestration"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "layer"; agent_id: string; id: string }
  | { kind: "setting"; agent_id: string; id: string }
  | { kind: "link"; agent_id: string; id: string }
  | { kind: "endpoint"; agent_id: string; id: string }
  | { kind: "task"; agent_id: string; id: string }
  | { kind: "file"; scope: "orchestration"; path: string }
  | { kind: "file"; scope: "agent"; agent_id: string; path: string };

export type InstallRecord = {
  installer_name: string;
  installer_version: string;
  workspace_id: string;
  orchestration_id: string;
  installed_at: string;
  /** Resources in creation order; uninstall deletes them in reverse. */
  applied: AppliedResource[];
  /** Per-custom-step undo state captured during install. */
  custom_steps: Array<{ id: string; undo_state: Record<string, unknown> }>;
};

export const INSTALL_RECORD_PATH = ".installer-state.json";

// --- Factory ---

/**
 * Identity factory that returns the definition unchanged, giving developers
 * full type-checking and inference. Mirrors `defineService` from app-builder.
 */
export function defineOrchestration(def: OrchestrationInstaller): OrchestrationInstaller {
  return def;
}

// --- Validation ---

export type ValidationIssue = { path: string; message: string };

/**
 * Structural validation of a definition. Returns a list of issues (empty when
 * valid) so the server can fail fast with clear messages before any API calls.
 */
export function validate(def: OrchestrationInstaller): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!def.installer_name?.trim()) add("installer_name", "is required");
  if (!def.installer_version?.trim()) add("installer_version", "is required");

  const orch = def.orchestration;
  if (!orch) {
    add("orchestration", "is required");
    return issues;
  }
  if (!orch.orchestration_name?.trim()) add("orchestration.orchestration_name", "is required");
  if (!orch.orchestration_description?.trim()) add("orchestration.orchestration_description", "is required");

  (orch.files ?? []).forEach((f, i) => validateFile(f, `orchestration.files[${i}]`, add));

  const agentNames = new Set<string>();
  (orch.agents ?? []).forEach((agent, ai) => {
    const base = `orchestration.agents[${ai}]`;
    if (!agent.agent_name?.trim()) add(`${base}.agent_name`, "is required");
    else if (agentNames.has(agent.agent_name)) add(`${base}.agent_name`, `duplicate agent name "${agent.agent_name}"`);
    else agentNames.add(agent.agent_name);
    if (!agent.agent_description?.trim()) add(`${base}.agent_description`, "is required");

    (agent.layers ?? []).forEach((layer, li) => {
      if (!layer.layer_name?.trim()) add(`${base}.layers[${li}].layer_name`, "is required");
      if (layer.temperature != null && (layer.temperature < 0 || layer.temperature > 2)) {
        add(`${base}.layers[${li}].temperature`, "must be between 0 and 2");
      }
    });

    (agent.settings ?? []).forEach((s, si) => {
      const sb = `${base}.settings[${si}]`;
      if (!s.setting_name?.trim()) add(`${sb}.setting_name`, "is required");
      if (!["Text", "Boolean", "Secret"].includes(s.setting_type)) {
        add(`${sb}.setting_type`, `invalid type "${s.setting_type}"`);
      }
      if (s.setting_type === "Boolean" && s.default != null && typeof s.default !== "boolean") {
        add(`${sb}.default`, "Boolean setting default must be a boolean");
      }
      if ((s.setting_type === "Text" || s.setting_type === "Secret") && s.default != null && typeof s.default !== "string") {
        add(`${sb}.default`, `${s.setting_type} setting default must be a string`);
      }
    });

    (agent.links ?? []).forEach((l, li) => {
      const lb = `${base}.links[${li}]`;
      if (!l.link_name?.trim()) add(`${lb}.link_name`, "is required");
      if (!l.link_url?.trim()) add(`${lb}.link_url`, "is required");
    });

    (agent.endpoints ?? []).forEach((e, ei) => {
      if (!e.endpoint?.trim()) add(`${base}.endpoints[${ei}].endpoint`, "is required");
    });

    (agent.tasks ?? []).forEach((t, ti) => {
      if (!t.message?.trim()) add(`${base}.tasks[${ti}].message`, "is required");
    });

    (agent.files ?? []).forEach((f, fi) => validateFile(f, `${base}.files[${fi}]`, add));
  });

  const stepIds = new Set<string>();
  (def.customSteps ?? []).forEach((step, i) => {
    const sb = `customSteps[${i}]`;
    if (!step.id?.trim()) add(`${sb}.id`, "is required");
    else if (stepIds.has(step.id)) add(`${sb}.id`, `duplicate step id "${step.id}"`);
    else stepIds.add(step.id);
    if (!step.title?.trim()) add(`${sb}.title`, "is required");
    if (!step.html?.trim()) add(`${sb}.html`, "is required");
  });

  return issues;
}

function validateFile(f: FileDef, path: string, add: (p: string, m: string) => void) {
  if (!f.path?.trim()) add(`${path}.path`, "is required");
  const hasContent = f.content != null;
  const hasSource = f.source != null;
  if (hasContent === hasSource) {
    add(path, "exactly one of `content` or `source` must be set");
  }
}

/** Compute the install-summary counts from the definition. */
export function computeSummary(def: OrchestrationInstaller): Required<InstallSummary> {
  const agents = def.orchestration.agents ?? [];
  let layers = 0;
  let settings = 0;
  let files = (def.orchestration.files ?? []).length;
  for (const a of agents) {
    layers += (a.layers ?? []).length;
    settings += (a.settings ?? []).length;
    files += (a.files ?? []).length;
  }
  return {
    agents: agents.length,
    layers,
    settings,
    files,
    custom_steps: (def.customSteps ?? []).length,
  };
}
