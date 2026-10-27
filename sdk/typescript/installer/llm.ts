// LLM resolution + availability for the installer.
//
// Developers reference an LLM by name on a layer (e.g. "claude-sonnet-5").
// Not every user has every LLM: provider LLMs (Anthropic/OpenAI) only appear
// after the user loads their own keys in the console, whereas the platform
// "GoogleOAI" models are provisioned for every account. We resolve a layer's
// preferred name against the user's available LLMs, falling back through:
//
//   preferred (llm_name)  ->  developer fallback (fallback_llm_name)  ->  gemini-2.5-flash:oai
//
// and surface which layers will fall back so the user can load keys first.

import type { Client } from "../client";
import { llmFind } from "../sdk.gen";
import type { OrchestrationInstaller } from "./define";

/**
 * LLMs every account is guaranteed to have (platform "GoogleOAI" provider).
 * Mirrors the backend's provider->models map; these require no user key.
 */
export const GUARANTEED_LLMS = [
  "gemini-2.5-flash:oai",
  "gemini-2.5-flash-lite:oai",
  "gemini-2.5-pro:oai",
  "xai@grok-4.1-fast-reasoning:oai",
  "xai@grok-4.1-fast-non-reasoning:oai",
  "xai@grok-4.20-reasoning:oai",
  "xai@grok-4.20-non-reasoning:oai",
  "xai@grok-4.3:oai",
] as const;

/** The ultimate fallback, guaranteed present for every user. */
export const ULTIMATE_FALLBACK_LLM = "gemini-2.5-flash:oai";

/** Console page where users load Anthropic/OpenAI keys to unlock more LLMs. */
export const LLM_KEYS_URL = "https://console.orchestration-ai.com/llm-keys";

/** An available LLM, by name, with its id. */
export type AvailableLlm = { id: string; llm_name: string };

/** Fetch the LLMs available to the authenticated user. */
export async function fetchAvailableLlms(client: Client): Promise<AvailableLlm[]> {
  const { data, error } = await llmFind({ client });
  if (error) throw new Error(`LLM lookup failed: ${JSON.stringify(error)}`);
  const out: AvailableLlm[] = [];
  for (const l of data?.llms ?? []) {
    if (l.id && l.llm_name) out.push({ id: l.id, llm_name: l.llm_name });
  }
  return out;
}

export type LlmResolution = {
  /** The name requested on the layer (may be undefined if the layer set none). */
  requested?: string;
  /** The name that will actually be used after applying the fallback chain. */
  effective: string;
  /** The resolved LLM id for `effective`. */
  id: string;
  /** Whether a fallback had to be applied (requested was unavailable). */
  fellBack: boolean;
  /** Which rung of the chain satisfied it. */
  source: "requested" | "developer-fallback" | "platform-fallback";
};

/**
 * Resolve a single layer's preferred/fallback names to an available LLM id,
 * walking: requested -> developer fallback -> platform fallback. A layer that
 * specifies no LLM at all still resolves to the platform fallback (so every
 * layer ends up with a guaranteed model the user cannot misconfigure).
 */
export function resolveLlm(
  llmName: string | undefined,
  fallbackName: string | undefined,
  available: AvailableLlm[]
): LlmResolution {
  const byName = new Map(available.map((l) => [l.llm_name, l.id]));

  if (llmName && byName.has(llmName)) {
    return { requested: llmName, effective: llmName, id: byName.get(llmName)!, fellBack: false, source: "requested" };
  }
  if (fallbackName && byName.has(fallbackName)) {
    return { requested: llmName, effective: fallbackName, id: byName.get(fallbackName)!, fellBack: true, source: "developer-fallback" };
  }
  // Platform fallback — guaranteed present. Reached when the preferred and the
  // developer fallback are unavailable, OR when the layer specified no LLM. If,
  // improbably, it isn't in the user's list, still reference it by name.
  const platformId = byName.get(ULTIMATE_FALLBACK_LLM);
  return {
    requested: llmName,
    effective: ULTIMATE_FALLBACK_LLM,
    id: platformId ?? "",
    fellBack: true,
    source: "platform-fallback",
  };
}

/** Per-layer availability report for the preflight UI. */
export type LayerLlmAvailability = {
  agent_name: string;
  layer_name: string;
  requested?: string;
  fallback?: string;
  effective: string;
  available: boolean; // whether the REQUESTED llm is available (no fallback needed)
  source: "requested" | "developer-fallback" | "platform-fallback" | "none";
};

export type LlmAvailabilityReport = {
  layers: LayerLlmAvailability[];
  /** True if any layer will fall back from its requested LLM. */
  anyFallback: boolean;
  /** Distinct requested-but-unavailable LLM names (what the user could load). */
  missing: string[];
  llmKeysUrl: string;
};

/**
 * Build a per-layer availability report for the definition against the user's
 * available LLMs. Powers the wizard's LLMs preflight screen.
 */
export function buildAvailabilityReport(
  def: OrchestrationInstaller,
  available: AvailableLlm[]
): LlmAvailabilityReport {
  const layers: LayerLlmAvailability[] = [];
  const missing = new Set<string>();

  for (const agent of def.orchestration.agents ?? []) {
    for (const layer of agent.layers ?? []) {
      const res = resolveLlm(layer.llm_name, layer.fallback_llm_name, available);
      const availableAsRequested = res.source === "requested";
      if (!availableAsRequested && layer.llm_name) missing.add(layer.llm_name);
      layers.push({
        agent_name: agent.agent_name,
        layer_name: layer.layer_name,
        requested: layer.llm_name,
        fallback: layer.fallback_llm_name,
        effective: res.effective,
        available: availableAsRequested,
        source: res.source,
      });
    }
  }

  return {
    layers,
    anyFallback: layers.some((l) => !l.available),
    missing: [...missing],
    llmKeysUrl: LLM_KEYS_URL,
  };
}
