import { describe, it, expect } from 'vitest';
import {
  resolveLlm,
  buildAvailabilityReport,
  GUARANTEED_LLMS,
  ULTIMATE_FALLBACK_LLM,
  LLM_KEYS_URL,
  type AvailableLlm,
} from '../typescript/installer/llm';
import { defineOrchestration, type OrchestrationInstaller } from '../typescript/installer/define';

const available: AvailableLlm[] = [
  { id: 'gem-flash', llm_name: 'gemini-2.5-flash:oai' },
  { id: 'gem-pro', llm_name: 'gemini-2.5-pro:oai' },
];

describe('constants', () => {
  it('exposes the guaranteed list, platform fallback, and console url', () => {
    expect(GUARANTEED_LLMS).toContain('gemini-2.5-flash:oai');
    expect(ULTIMATE_FALLBACK_LLM).toBe('gemini-2.5-flash:oai');
    expect(LLM_KEYS_URL).toBe('https://console.orchestration-ai.com/llm-keys');
  });
});

describe('resolveLlm', () => {
  it('defaults to the platform fallback when nothing is requested', () => {
    const r = resolveLlm(undefined, undefined, available);
    expect(r).toMatchObject({ requested: undefined, effective: ULTIMATE_FALLBACK_LLM, id: 'gem-flash', fellBack: true, source: 'platform-fallback' });
  });

  it('uses the requested llm when available', () => {
    const r = resolveLlm('gemini-2.5-pro:oai', undefined, available);
    expect(r).toMatchObject({ effective: 'gemini-2.5-pro:oai', id: 'gem-pro', fellBack: false, source: 'requested' });
  });

  it('falls back to the developer fallback when the preferred is missing', () => {
    const r = resolveLlm('claude-sonnet-5', 'gemini-2.5-pro:oai', available);
    expect(r).toMatchObject({ effective: 'gemini-2.5-pro:oai', id: 'gem-pro', fellBack: true, source: 'developer-fallback' });
    expect(r.requested).toBe('claude-sonnet-5');
  });

  it('falls back to the platform llm when preferred + developer fallback are missing', () => {
    const r = resolveLlm('claude-sonnet-5', 'claude-opus-4-8', available)!;
    expect(r).toMatchObject({ effective: ULTIMATE_FALLBACK_LLM, id: 'gem-flash', fellBack: true, source: 'platform-fallback' });
  });

  it('references the platform fallback by name even if absent from the user list', () => {
    const r = resolveLlm('claude-sonnet-5', undefined, [])!;
    expect(r.effective).toBe(ULTIMATE_FALLBACK_LLM);
    expect(r.id).toBe(''); // not in list; still referenced by name
    expect(r.source).toBe('platform-fallback');
  });
});

describe('buildAvailabilityReport', () => {
  const def: OrchestrationInstaller = defineOrchestration({
    installer_name: 'T',
    installer_version: '1.0.0',
    orchestration: {
      orchestration_name: 'o',
      orchestration_description: 'd',
      agents: [
        {
          agent_name: 'a1',
          agent_description: 'd',
          layers: [
            { layer_name: 'has-it', llm_name: 'gemini-2.5-pro:oai' },
            { layer_name: 'needs-fallback', llm_name: 'claude-sonnet-5', fallback_llm_name: 'gemini-2.5-flash:oai' },
            { layer_name: 'no-llm' },
          ],
        },
      ],
    },
  });

  it('reports per-layer availability and overall fallback flag', () => {
    const report = buildAvailabilityReport(def, available);
    // Every layer is included, including the one with no LLM specified.
    expect(report.layers).toHaveLength(3);

    const hasIt = report.layers.find((l) => l.layer_name === 'has-it')!;
    expect(hasIt.available).toBe(true);
    expect(hasIt.source).toBe('requested');

    const needs = report.layers.find((l) => l.layer_name === 'needs-fallback')!;
    expect(needs.available).toBe(false);
    expect(needs.effective).toBe('gemini-2.5-flash:oai');

    // A layer with no requested LLM falls back to the platform model and is
    // shown as a (non-editable) fallback.
    const noLlm = report.layers.find((l) => l.layer_name === 'no-llm')!;
    expect(noLlm.requested).toBeUndefined();
    expect(noLlm.available).toBe(false);
    expect(noLlm.source).toBe('platform-fallback');
    expect(noLlm.effective).toBe('gemini-2.5-flash:oai');

    expect(report.anyFallback).toBe(true);
    expect(report.missing).toContain('claude-sonnet-5');
    // The no-llm layer must NOT pollute the "load these keys" list.
    expect(report.missing).toHaveLength(1);
    expect(report.llmKeysUrl).toBe(LLM_KEYS_URL);
  });

  it('reports no fallback when everything requested is available', () => {
    const okDef: OrchestrationInstaller = defineOrchestration({
      installer_name: 'T',
      installer_version: '1.0.0',
      orchestration: {
        orchestration_name: 'o',
        orchestration_description: 'd',
        agents: [{ agent_name: 'a', agent_description: 'd', layers: [{ layer_name: 'l', llm_name: 'gemini-2.5-pro:oai' }] }],
      },
    });
    const report = buildAvailabilityReport(okDef, available);
    expect(report.anyFallback).toBe(false);
    expect(report.missing).toEqual([]);
  });
});
