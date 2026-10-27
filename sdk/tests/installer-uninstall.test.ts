import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../typescript/sdk.gen', () => {
  const ok = (data: any) => Promise.resolve({ data, error: undefined });
  return {
    orchestrationDeleteById: vi.fn(() => ok({})),
    storageDownloadFileOrch: vi.fn(),
    orchestrationFindByWorkspace: vi.fn(),
  };
});

import * as sdk from '../typescript/sdk.gen';
import { uninstall, loadInstallRecord, findInstalls, type UninstallProgressEvent } from '../typescript/installer/uninstall';
import { defineOrchestration, type InstallRecord, type OrchestrationInstaller } from '../typescript/installer/define';

const fakeClient = {} as any;

const record: InstallRecord = {
  installer_name: 'T',
  installer_version: '1.0.0',
  workspace_id: 'ws-1',
  orchestration_id: 'orch-1',
  installed_at: new Date().toISOString(),
  applied: [{ kind: 'orchestration', id: 'orch-1' }],
  custom_steps: [{ id: 'stripe', undo_state: { webhook: 'wh_1' } }],
};

beforeEach(() => vi.clearAllMocks());

describe('uninstall', () => {
  it('runs custom-step teardown hooks before deleting the orchestration', async () => {
    const order: string[] = [];
    const uninstallHook = vi.fn(async () => { order.push('step'); });
    (sdk.orchestrationDeleteById as any).mockImplementation(() => { order.push('delete'); return Promise.resolve({ data: {}, error: undefined }); });

    const def: OrchestrationInstaller = defineOrchestration({
      installer_name: 'T',
      installer_version: '1.0.0',
      orchestration: { orchestration_name: 'o', orchestration_description: 'd' },
      customSteps: [{ id: 'stripe', title: 'Stripe', html: '<div></div>', uninstall: uninstallHook }],
    });

    const events: UninstallProgressEvent[] = [];
    await uninstall({ client: fakeClient, record, def, onProgress: (e) => events.push(e) });

    expect(uninstallHook).toHaveBeenCalledWith(
      expect.objectContaining({ undo_state: { webhook: 'wh_1' }, orchestrationId: 'orch-1' })
    );
    expect(order).toEqual(['step', 'delete']); // teardown first
    expect(sdk.orchestrationDeleteById).toHaveBeenCalledWith(
      expect.objectContaining({ path: { workspaceId: 'ws-1', id: 'orch-1' } })
    );
    expect(events.map((e) => e.phase)).toContain('complete');
  });

  it('continues deleting even if a step hook throws', async () => {
    const def: OrchestrationInstaller = defineOrchestration({
      installer_name: 'T',
      installer_version: '1.0.0',
      orchestration: { orchestration_name: 'o', orchestration_description: 'd' },
      customSteps: [{ id: 'stripe', title: 'S', html: '<div></div>', uninstall: async () => { throw new Error('3p down'); } }],
    });

    const events: UninstallProgressEvent[] = [];
    await uninstall({ client: fakeClient, record, def, onProgress: (e) => events.push(e) });

    expect(events.some((e) => e.phase === 'step' && e.status === 'failed')).toBe(true);
    expect(sdk.orchestrationDeleteById).toHaveBeenCalled();
  });

  it('throws when orchestration deletion fails', async () => {
    (sdk.orchestrationDeleteById as any).mockResolvedValueOnce({ data: undefined, error: { message: 'nope' } });
    const def: OrchestrationInstaller = defineOrchestration({
      installer_name: 'T',
      installer_version: '1.0.0',
      orchestration: { orchestration_name: 'o', orchestration_description: 'd' },
    });
    await expect(uninstall({ client: fakeClient, record, def })).rejects.toThrow(/uninstall failed/);
  });

  it('fires onUninstalled after a successful uninstall', async () => {
    const onUninstalled = vi.fn(async () => {});
    const def: OrchestrationInstaller = defineOrchestration({
      installer_name: 'T',
      installer_version: '1.0.0',
      orchestration: { orchestration_name: 'o', orchestration_description: 'd' },
      onUninstalled,
    });
    const events: UninstallProgressEvent[] = [];
    await uninstall({ client: fakeClient, record, def, onProgress: (e) => events.push(e) });
    expect(onUninstalled).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', orchestrationId: 'orch-1', record: expect.objectContaining({ installer_name: 'T' }) })
    );
    expect(events.some((e) => e.phase === 'hook' && e.status === 'done')).toBe(true);
  });

  it('does not fail uninstall when onUninstalled throws', async () => {
    (sdk.orchestrationDeleteById as any).mockResolvedValue({ data: {}, error: undefined });
    const def: OrchestrationInstaller = defineOrchestration({
      installer_name: 'T',
      installer_version: '1.0.0',
      orchestration: { orchestration_name: 'o', orchestration_description: 'd' },
      onUninstalled: async () => { throw new Error('notify failed'); },
    });
    const events: UninstallProgressEvent[] = [];
    await uninstall({ client: fakeClient, record, def, onProgress: (e) => events.push(e) });
    expect(events.some((e) => e.phase === 'hook' && e.status === 'failed')).toBe(true);
    expect(events.some((e) => e.phase === 'complete')).toBe(true);
  });
});

describe('loadInstallRecord', () => {
  it('follows a signed download URL to fetch the record JSON', async () => {
    (sdk.storageDownloadFileOrch as any).mockResolvedValue({ data: { download_url: 'https://gcs/rec' }, error: undefined });
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(record) })) as any;

    const loaded = await loadInstallRecord(fakeClient, 'ws-1', 'orch-1');
    expect(loaded?.orchestration_id).toBe('orch-1');
  });

  it('returns null when the file is missing', async () => {
    (sdk.storageDownloadFileOrch as any).mockResolvedValue({ data: undefined, error: { message: 'not found' } });
    const loaded = await loadInstallRecord(fakeClient, 'ws-1', 'orch-1');
    expect(loaded).toBeNull();
  });

  it('parses an inline string body', async () => {
    (sdk.storageDownloadFileOrch as any).mockResolvedValue({ data: JSON.stringify(record), error: undefined });
    const loaded = await loadInstallRecord(fakeClient, 'ws-1', 'orch-1');
    expect(loaded?.installer_name).toBe('T');
  });
});

describe('findInstalls', () => {
  it('returns orchestrations whose install record matches this installer', async () => {
    (sdk.orchestrationFindByWorkspace as any).mockResolvedValue({
      data: {
        orchestrations: [
          { id: 'orch-1', orchestration_name: 'sales-copilot' },
          { id: 'orch-2', orchestration_name: 'other-thing' },
          { id: 'orch-3', orchestration_name: 'no-record' },
        ],
      },
      error: undefined,
    });
    // orch-1 belongs to installer "T"; orch-2 to a different installer; orch-3 has no record.
    (sdk.storageDownloadFileOrch as any).mockImplementation((opts: any) => {
      const oid = opts.path.orchestrationId;
      if (oid === 'orch-1') return Promise.resolve({ data: JSON.stringify({ ...record, installed_at: '2026-01-01T00:00:00Z' }), error: undefined });
      if (oid === 'orch-2') return Promise.resolve({ data: JSON.stringify({ ...record, installer_name: 'Other' }), error: undefined });
      return Promise.resolve({ data: undefined, error: { message: 'not found' } });
    });

    const installs = await findInstalls(fakeClient, 'ws-1', 'T');
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({ orchestration_id: 'orch-1', orchestration_name: 'sales-copilot', installer_name: 'T' });
  });

  it('sorts most-recently-installed first', async () => {
    (sdk.orchestrationFindByWorkspace as any).mockResolvedValue({
      data: { orchestrations: [{ id: 'a', orchestration_name: 'a' }, { id: 'b', orchestration_name: 'b' }] },
      error: undefined,
    });
    (sdk.storageDownloadFileOrch as any).mockImplementation((opts: any) => {
      const oid = opts.path.orchestrationId;
      const installed_at = oid === 'a' ? '2026-01-01T00:00:00Z' : '2026-06-01T00:00:00Z';
      return Promise.resolve({ data: JSON.stringify({ ...record, installed_at }), error: undefined });
    });
    const installs = await findInstalls(fakeClient, 'ws-1', 'T');
    expect(installs.map((i) => i.orchestration_id)).toEqual(['b', 'a']);
  });

  it('returns [] when listing fails', async () => {
    (sdk.orchestrationFindByWorkspace as any).mockResolvedValue({ data: undefined, error: { message: 'boom' } });
    expect(await findInstalls(fakeClient, 'ws-1', 'T')).toEqual([]);
  });
});
