import { describe, it, expect } from 'vitest';
import {
  parseStepResult,
  mergeStepSettings,
  collectUndoState,
  STEP_RESULT_MESSAGE,
  type ResolvedSetting,
} from '../typescript/installer/bridge';
import { defineOrchestration, type OrchestrationInstaller } from '../typescript/installer/define';

const def: OrchestrationInstaller = defineOrchestration({
  installer_name: 'T',
  installer_version: '1.0.0',
  orchestration: {
    orchestration_name: 'o',
    orchestration_description: 'd',
    agents: [{ agent_name: 'billing', agent_description: 'd' }],
  },
});

describe('parseStepResult', () => {
  it('parses a well-formed message', () => {
    const msg = parseStepResult({
      type: STEP_RESULT_MESSAGE,
      stepId: 'stripe',
      result: { settings: [], undo_state: { a: 1 } },
    });
    expect(msg).not.toBeNull();
    expect(msg!.stepId).toBe('stripe');
  });

  it('rejects wrong type, missing fields, and non-objects', () => {
    expect(parseStepResult(null)).toBeNull();
    expect(parseStepResult({ type: 'other', stepId: 'x', result: {} })).toBeNull();
    expect(parseStepResult({ type: STEP_RESULT_MESSAGE, result: {} })).toBeNull();
    expect(parseStepResult({ type: STEP_RESULT_MESSAGE, stepId: 'x' })).toBeNull();
  });
});

describe('mergeStepSettings', () => {
  const existing: ResolvedSetting[] = [
    { agent_name: 'billing', setting_name: 'region', setting_description: 'r', setting_type: 'Text', value: 'eu' },
  ];

  it('adds a new setting from a step for a known agent', () => {
    const merged = mergeStepSettings(
      existing,
      [{ stepId: 'stripe', result: { settings: [{ agent_name: 'billing', setting_name: 'stripe_key', setting_type: 'Secret', value: 'sk_123' }] } }],
      def
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.setting_name === 'stripe_key')!.setting_type).toBe('Secret');
  });

  it('overrides an existing setting value', () => {
    const merged = mergeStepSettings(
      existing,
      [{ stepId: 'x', result: { settings: [{ agent_name: 'billing', setting_name: 'region', setting_type: 'Text', value: 'us' }] } }],
      def
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('us');
  });

  it('drops settings for unknown agents and invalid types', () => {
    const merged = mergeStepSettings(
      existing,
      [{
        stepId: 'x',
        result: {
          settings: [
            { agent_name: 'ghost', setting_name: 'x', setting_type: 'Text', value: '1' },
            { agent_name: 'billing', setting_name: 'bad', setting_type: 'Nope' as any, value: '1' },
          ],
        },
      }],
      def
    );
    expect(merged).toHaveLength(1); // only the original
  });
});

describe('collectUndoState', () => {
  it('maps step results to id + undo_state, defaulting to {}', () => {
    const undo = collectUndoState([
      { stepId: 'a', result: { undo_state: { webhook: 'wh_1' } } },
      { stepId: 'b', result: {} },
    ]);
    expect(undo).toEqual([
      { id: 'a', undo_state: { webhook: 'wh_1' } },
      { id: 'b', undo_state: {} },
    ]);
  });
});
