import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the generated SDK so apply() exercises its orchestration logic without
// real HTTP. Each create returns a deterministic id; storage upload returns a
// signed URL; serviceFind returns one service.
vi.mock('../typescript/sdk.gen', () => {
  const ok = (data: any) => Promise.resolve({ data, error: undefined });
  return {
    orchestrationCreate: vi.fn(() => ok({ id: 'orch-1' })),
    agentCreate: vi.fn(() => ok({ id: 'agent-1' })),
    layerCreate: vi.fn(() => ok({ id: 'layer-1' })),
    settingCreate: vi.fn(() => ok({ id: 'setting-1' })),
    linkCreate: vi.fn(() => ok({ id: 'link-1' })),
    endpointCreate: vi.fn(() => ok({ id: 'endpoint-1' })),
    taskCreate: vi.fn(() => ok({ id: 'task-1' })),
    serviceFind: vi.fn(() => ok({ services: [{ unique_name: 'messaging', id: 'messaging' }] })),
    llmFind: vi.fn(() => ok({ llms: [{ id: 'gem-flash', llm_name: 'gemini-2.5-flash:oai' }, { id: 'gem-pro', llm_name: 'gemini-2.5-pro:oai' }] })),
    workspaceCreate: vi.fn(() => ok({ id: 'ws-new' })),
    orchestrationDeleteById: vi.fn(() => ok({})),
    storageUploadFileOrch: vi.fn(() => ok({ upload_url: 'https://gcs/orch', max_size_bytes: 1000 })),
    storageUploadFileAgent: vi.fn(() => ok({ upload_url: 'https://gcs/agent', max_size_bytes: 1000 })),
    storageDeleteFileOrch: vi.fn(() => ok({})),
    storageDeleteFileAgent: vi.fn(() => ok({})),
  };
});

import * as sdk from '../typescript/sdk.gen';
import { apply, type ProgressEvent } from '../typescript/installer/apply';
import { defineOrchestration, type OrchestrationInstaller } from '../typescript/installer/define';

const fakeClient = {} as any;

const def: OrchestrationInstaller = defineOrchestration({
  installer_name: 'T',
  installer_version: '1.0.0',
  orchestration: {
    orchestration_name: 'orch',
    orchestration_description: 'd',
    files: [{ path: 'playbook.md', content: '#' }],
    agents: [
      {
        agent_name: 'triage',
        agent_description: 'd',
        layers: [{ layer_name: 'classify', services: ['messaging'] }],
      },
    ],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  // Mock the GCS PUT (upload) to always succeed.
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })) as any;
});

describe('apply (happy path)', () => {
  it('creates resources in order, resolves services, and returns an install record', async () => {
    const events: ProgressEvent[] = [];
    const record = await apply(def, {
      client: fakeClient,
      workspaceId: 'ws-1',
      settings: [],
      onProgress: (e) => events.push(e),
      readSource: async () => new Uint8Array(),
    });

    expect(sdk.orchestrationCreate).toHaveBeenCalledOnce();
    expect(sdk.agentCreate).toHaveBeenCalledOnce();
    // service logical name resolved to id (id == unique_name)
    expect(sdk.layerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ services: [{ id: 'messaging' }] }) })
    );

    // orchestration file + install record both uploaded at orch scope
    expect(sdk.storageUploadFileOrch).toHaveBeenCalledTimes(2);

    expect(record.orchestration_id).toBe('orch-1');
    expect(record.workspace_id).toBe('ws-1');
    expect(record.applied.some((a) => a.kind === 'orchestration')).toBe(true);

    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe('start');
    expect(phases).toContain('complete');
  });

  it('resolves a layer llm_name to its id, falling back to the platform llm', async () => {
    const llmDef: OrchestrationInstaller = {
      ...def,
      orchestration: {
        ...def.orchestration,
        agents: [
          {
            agent_name: 'triage',
            agent_description: 'd',
            layers: [
              { layer_name: 'prefers-available', llm_name: 'gemini-2.5-pro:oai' },
              { layer_name: 'prefers-missing', llm_name: 'claude-sonnet-5' }, // falls back to gemini-2.5-flash:oai
            ],
          },
        ],
      },
    };
    await apply(llmDef, { client: fakeClient, workspaceId: 'ws-1', settings: [], readSource: async () => new Uint8Array() });

    const calls = (sdk.layerCreate as any).mock.calls;
    const bodies = calls.map((c: any[]) => c[0].body);
    const available = bodies.find((b: any) => b.layer_name === 'prefers-available');
    const missing = bodies.find((b: any) => b.layer_name === 'prefers-missing');
    expect(available.llm).toEqual({ id: 'gem-pro' });     // requested, available
    expect(missing.llm).toEqual({ id: 'gem-flash' });     // fell back to platform llm id
  });

  it('creates a new workspace when createWorkspaceName is given', async () => {
    const record = await apply(def, {
      client: fakeClient,
      createWorkspaceName: 'Fresh WS',
      settings: [],
      readSource: async () => new Uint8Array(),
    });
    expect(sdk.workspaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ body: { workspace_name: 'Fresh WS' } })
    );
    expect(record.workspace_id).toBe('ws-new');
  });

  it('writes resolved settings for the matching agent', async () => {
    await apply(def, {
      client: fakeClient,
      workspaceId: 'ws-1',
      settings: [
        { agent_name: 'triage', setting_name: 'region', setting_description: 'r', setting_type: 'Text', value: 'eu' },
        { agent_name: 'other', setting_name: 'x', setting_description: '', setting_type: 'Text', value: 'y' },
      ],
      readSource: async () => new Uint8Array(),
    });
    // Only the triage setting should be created.
    expect(sdk.settingCreate).toHaveBeenCalledOnce();
    expect(sdk.settingCreate).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ setting_name: 'region', text_value: 'eu' }) })
    );
  });
});

describe('apply (onInstalled hook)', () => {
  const defWithHook = (onInstalled: any): OrchestrationInstaller => ({ ...def, onInstalled });

  it('fires onInstalled after a successful install with record + settings', async () => {
    const onInstalled = vi.fn(async () => {});
    const events: ProgressEvent[] = [];
    await apply(defWithHook(onInstalled), {
      client: fakeClient,
      workspaceId: 'ws-1',
      settings: [
        { agent_name: 'triage', setting_name: 'email', setting_description: '', setting_type: 'Text', value: 'a@b.com' },
      ],
      onProgress: (e) => events.push(e),
      readSource: async () => new Uint8Array(),
    });

    expect(onInstalled).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        orchestrationId: 'orch-1',
        record: expect.objectContaining({ orchestration_id: 'orch-1' }),
        settings: [expect.objectContaining({ setting_name: 'email', value: 'a@b.com' })],
      })
    );
    // Reported as a hook phase and still completes.
    expect(events.some((e) => e.phase === 'hook' && e.status === 'done')).toBe(true);
    expect(events.some((e) => e.phase === 'complete')).toBe(true);
  });

  it('does not fail the install when onInstalled throws', async () => {
    const onInstalled = vi.fn(async () => { throw new Error('email provider down'); });
    const events: ProgressEvent[] = [];
    const record = await apply(defWithHook(onInstalled), {
      client: fakeClient,
      workspaceId: 'ws-1',
      settings: [],
      onProgress: (e) => events.push(e),
      readSource: async () => new Uint8Array(),
    });
    expect(record.orchestration_id).toBe('orch-1');
    expect(events.some((e) => e.phase === 'hook' && e.status === 'failed')).toBe(true);
    expect(events.some((e) => e.phase === 'complete')).toBe(true);
    // No rollback happened.
    expect(sdk.orchestrationDeleteById).not.toHaveBeenCalled();
  });
});

describe('apply (rollback)', () => {
  it('rolls back by deleting the orchestration on failure', async () => {
    (sdk.agentCreate as any).mockResolvedValueOnce({ data: undefined, error: { message: 'boom' } });

    await expect(
      apply(def, {
        client: fakeClient,
        workspaceId: 'ws-1',
        settings: [],
        readSource: async () => new Uint8Array(),
      })
    ).rejects.toThrow(/rolled back/);

    expect(sdk.orchestrationDeleteById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { workspaceId: 'ws-1', id: 'orch-1' } })
    );
  });

  it('runs custom-step teardown during rollback', async () => {
    (sdk.agentCreate as any).mockResolvedValueOnce({ data: undefined, error: { message: 'boom' } });
    const runStepUninstall = vi.fn(async () => {});

    await expect(
      apply(def, {
        client: fakeClient,
        workspaceId: 'ws-1',
        settings: [],
        customStepUndo: [{ id: 'stripe', undo_state: { webhook: 'wh_1' } }],
        runStepUninstall,
        readSource: async () => new Uint8Array(),
      })
    ).rejects.toThrow();

    expect(runStepUninstall).toHaveBeenCalledWith('stripe', { webhook: 'wh_1' }, expect.any(Object));
  });
});
