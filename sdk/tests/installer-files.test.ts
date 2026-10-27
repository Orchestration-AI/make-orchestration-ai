import { describe, it, expect } from 'vitest';
import { inferContentType, resolveFileBytes } from '../typescript/installer/files';
import { plan } from '../typescript/installer/apply';
import { defineOrchestration, type OrchestrationInstaller } from '../typescript/installer/define';

describe('inferContentType', () => {
  it('honours an explicit override', () => {
    expect(inferContentType('x.bin', 'application/custom')).toBe('application/custom');
  });

  it('maps known extensions', () => {
    expect(inferContentType('a.json')).toBe('application/json');
    expect(inferContentType('a.md')).toBe('text/markdown');
    expect(inferContentType('a.pdf')).toBe('application/pdf');
    expect(inferContentType('a.PNG')).toBe('image/png');
  });

  it('falls back to octet-stream', () => {
    expect(inferContentType('a.unknownext')).toBe('application/octet-stream');
  });
});

describe('resolveFileBytes', () => {
  const read = async () => new Uint8Array([1, 2, 3]);

  it('encodes inline content as text', async () => {
    const { data, contentType } = await resolveFileBytes({ path: 'a.txt', content: 'hi' }, read);
    expect(new TextDecoder().decode(data)).toBe('hi');
    expect(contentType).toBe('text/plain');
  });

  it('reads source via the provided reader', async () => {
    const { data, contentType } = await resolveFileBytes({ path: 'a.pdf', source: './a.pdf' }, read);
    expect([...data]).toEqual([1, 2, 3]);
    expect(contentType).toBe('application/pdf');
  });

  it('rejects when both content and source are set', async () => {
    await expect(resolveFileBytes({ path: 'a', content: 'x', source: './a' }, read)).rejects.toThrow(/exactly one/);
  });
});

describe('plan', () => {
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
          layers: [{ layer_name: 'classify' }],
          settings: [{ setting_name: 'region', setting_description: 'r', setting_type: 'Text' }],
          links: [{ link_name: 'docs', link_description: 'd', link_url: 'https://x' }],
          endpoints: [{ description: 'hook', endpoint: '/hook' }],
          tasks: [{ message: 'run daily report' }],
          files: [{ path: 'c.json', content: '{}' }],
        },
      ],
    },
  });

  it('lists resources in dependency order', () => {
    const { items } = plan(def);
    const kinds = items.map((i) => i.kind);
    expect(kinds[0]).toBe('orchestration');
    // orchestration file comes before the agent
    expect(kinds.indexOf('file')).toBeLessThan(kinds.indexOf('agent'));
    // agent precedes its layer/setting/link/endpoint/task
    const agentIdx = kinds.indexOf('agent');
    expect(agentIdx).toBeLessThan(kinds.indexOf('layer'));
    expect(kinds).toEqual(
      expect.arrayContaining(['orchestration', 'file', 'agent', 'layer', 'setting', 'link', 'endpoint', 'task'])
    );
  });

  it('computes a matching summary', () => {
    const { summary } = plan(def);
    expect(summary.agents).toBe(1);
    expect(summary.layers).toBe(1);
    expect(summary.files).toBe(2);
  });
});
