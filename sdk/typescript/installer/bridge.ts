// Custom-step bridge.
//
// Custom steps run as sandboxed iframes inside the wizard. They communicate
// their results (settings to add + undo_state for teardown) to the wizard via
// window.postMessage. This module defines the message contract, the browser
// snippet injected into the wizard to receive messages, and the server-side
// merge of emitted settings into the resolved setting values.

import type { CustomStepResult, OrchestrationInstaller, SettingType } from "./define";

/** Message type the custom step posts to the parent wizard window. */
export const STEP_RESULT_MESSAGE = "oai:step-result";

export type StepResultMessage = {
  type: typeof STEP_RESULT_MESSAGE;
  stepId: string;
  result: CustomStepResult;
};

/** Validate an incoming postMessage payload is a well-formed step result. */
export function parseStepResult(data: unknown): StepResultMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type !== STEP_RESULT_MESSAGE) return null;
  if (typeof m.stepId !== "string") return null;
  const result = m.result;
  if (!result || typeof result !== "object") return null;
  return { type: STEP_RESULT_MESSAGE, stepId: m.stepId, result: result as CustomStepResult };
}

/**
 * Browser snippet (returned as a string, injected into the wizard) that listens
 * for step-result messages from iframes and reports them back to the wizard's
 * collector. Enforces that the message originates from the wizard's own origin
 * (steps are served same-origin under the installer server), rejecting others.
 */
export function bridgeListenerScript(): string {
  return `
  (function () {
    var EXPECTED_ORIGIN = window.location.origin;
    window.addEventListener('message', function (event) {
      if (event.origin !== EXPECTED_ORIGIN) return; // origin validation
      var data = event.data;
      if (!data || data.type !== '${STEP_RESULT_MESSAGE}') return;
      if (typeof data.stepId !== 'string' || !data.result) return;
      if (typeof window.__oaiReceiveStepResult === 'function') {
        window.__oaiReceiveStepResult(data.stepId, data.result);
      }
    });
  })();
  `;
}

/**
 * Snippet exposed to custom-step authors (served alongside their HTML) giving
 * them a tiny helper to emit their result without hand-writing postMessage.
 */
export function stepClientScript(stepId: string): string {
  return `
  window.oaiStep = {
    stepId: ${JSON.stringify(stepId)},
    /** settings: [{agent_name, setting_name, setting_type, value, setting_description?}], undo_state: {} */
    complete: function (result) {
      window.parent.postMessage(
        { type: '${STEP_RESULT_MESSAGE}', stepId: this.stepId, result: result || {} },
        window.location.origin
      );
    },
  };
  `;
}

// --- Server-side merge ---

/**
 * A resolved setting value destined for a specific agent, produced by merging
 * definition defaults, user review edits, and custom-step outputs.
 */
export type ResolvedSetting = {
  agent_name: string;
  setting_name: string;
  setting_description: string;
  setting_type: SettingType;
  value: string | boolean;
};

/**
 * Merge custom-step emitted settings into an existing resolved-settings map.
 * Custom-step settings override any existing value for the same agent+name.
 * Validates each against the step-result shape and drops malformed entries.
 */
export function mergeStepSettings(
  existing: ResolvedSetting[],
  results: Array<{ stepId: string; result: CustomStepResult }>,
  def: OrchestrationInstaller
): ResolvedSetting[] {
  const agentNames = new Set((def.orchestration.agents ?? []).map((a) => a.agent_name));
  const byKey = new Map<string, ResolvedSetting>();
  for (const s of existing) byKey.set(`${s.agent_name}::${s.setting_name}`, s);

  for (const { result } of results) {
    for (const s of result.settings ?? []) {
      if (!agentNames.has(s.agent_name)) continue; // only known agents
      if (!s.setting_name) continue;
      if (!["Text", "Boolean", "Secret"].includes(s.setting_type)) continue;
      byKey.set(`${s.agent_name}::${s.setting_name}`, {
        agent_name: s.agent_name,
        setting_name: s.setting_name,
        setting_description: s.setting_description ?? "",
        setting_type: s.setting_type,
        value: s.value,
      });
    }
  }
  return [...byKey.values()];
}

/** Collect undo_state keyed by step id from a set of step results. */
export function collectUndoState(
  results: Array<{ stepId: string; result: CustomStepResult }>
): Array<{ id: string; undo_state: Record<string, unknown> }> {
  return results.map((r) => ({
    id: r.stepId,
    undo_state: r.result.undo_state ?? {},
  }));
}
