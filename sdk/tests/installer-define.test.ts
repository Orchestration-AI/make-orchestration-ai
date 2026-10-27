import { describe, it, expect } from 'vitest';
import {
  defineOrchestration,
  validate,
  computeSummary,
  INSTALL_RECORD_PATH,
  type OrchestrationInstaller,
} from '../typescript/installer/define';

// A minimal valid definition reused across tests.
const baseDef = (): OrchestrationInstaller =>
  defineOrchestration({
    installer_name: 'Test Installer',
    installer_version: '1.0.0',
    orchestration: {
      orchestration_name: 'test-orch',
      orchestration_description: 'A test orchestration',
      agents: [
        {
          agent_name: 'triage',
          agent_description: 'Triages things',
          layers: [{ layer_name: 'classify', temperature: 0.5 }],
          settings: [
            { setting_name: 'region', setting_description: 'Region', setting_type: 'Text', default: 'eu' },
          ],
        },
      ],
    },
  });

describe('defineOrchestration', () => {
  it('returns the definition unchanged', () => {
    const def = baseDef();
    expect(defineOrchestration(def)).toBe(def);
  });
});

describe('validate', () => {
  it('passes a valid definition', () => {
    expect(validate(baseDef())).toEqual([]);
  });

  it('requires installer_name and installer_version', () => {
    const def = baseDef();
    (def as any).installer_name = '';
    (def as any).installer_version = '';
    const issues = validate(def);
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['installer_name', 'installer_version'])
    );
  });

  it('requires orchestration name and description', () => {
    const def = baseDef();
    def.orchestration.orchestration_name = '';
    def.orchestration.orchestration_description = '';
    const issues = validate(def);
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining([
        'orchestration.orchestration_name',
        'orchestration.orchestration_description',
      ])
    );
  });

  it('flags duplicate agent names', () => {
    const def = baseDef();
    def.orchestration.agents!.push({
      agent_name: 'triage',
      agent_description: 'dup',
    });
    const issues = validate(def);
    expect(issues.some((i) => i.message.includes('duplicate agent name'))).toBe(true);
  });

  it('flags invalid setting type', () => {
    const def = baseDef();
    (def.orchestration.agents![0].settings![0] as any).setting_type = 'Nope';
    const issues = validate(def);
    expect(issues.some((i) => i.path.endsWith('.setting_type'))).toBe(true);
  });

  it('flags a Boolean setting with a non-boolean default', () => {
    const def = baseDef();
    def.orchestration.agents![0].settings![0] = {
      setting_name: 'flag',
      setting_description: 'x',
      setting_type: 'Boolean',
      default: 'not-a-bool' as any,
    };
    const issues = validate(def);
    expect(issues.some((i) => i.path.endsWith('.default'))).toBe(true);
  });

  it('flags temperature out of range', () => {
    const def = baseDef();
    def.orchestration.agents![0].layers![0].temperature = 5;
    const issues = validate(def);
    expect(issues.some((i) => i.path.endsWith('.temperature'))).toBe(true);
  });

  it('requires exactly one of content or source for files', () => {
    const def = baseDef();
    def.orchestration.files = [{ path: 'a.txt', content: 'x', source: './a.txt' }];
    const bothIssues = validate(def);
    expect(bothIssues.some((i) => i.message.includes('exactly one'))).toBe(true);

    def.orchestration.files = [{ path: 'a.txt' }];
    const neitherIssues = validate(def);
    expect(neitherIssues.some((i) => i.message.includes('exactly one'))).toBe(true);

    def.orchestration.files = [{ path: 'a.txt', content: 'x' }];
    expect(validate(def)).toEqual([]);
  });

  it('flags duplicate custom step ids', () => {
    const def = baseDef();
    def.customSteps = [
      { id: 'stripe', title: 'A', html: '<div></div>' },
      { id: 'stripe', title: 'B', html: '<div></div>' },
    ];
    const issues = validate(def);
    expect(issues.some((i) => i.message.includes('duplicate step id'))).toBe(true);
  });
});

describe('computeSummary', () => {
  it('counts nested resources', () => {
    const def = baseDef();
    def.orchestration.files = [{ path: 'playbook.md', content: '#' }];
    def.orchestration.agents![0].layers!.push({ layer_name: 'respond' });
    def.orchestration.agents![0].files = [{ path: 'c.json', content: '{}' }];
    def.customSteps = [{ id: 's1', title: 'S', html: '<div></div>' }];

    const summary = computeSummary(def);
    expect(summary).toEqual({
      agents: 1,
      layers: 2,
      settings: 1,
      files: 2, // 1 orchestration + 1 agent
      custom_steps: 1,
    });
  });
});

describe('constants', () => {
  it('exposes the install record path', () => {
    expect(INSTALL_RECORD_PATH).toBe('.installer-state.json');
  });
});
