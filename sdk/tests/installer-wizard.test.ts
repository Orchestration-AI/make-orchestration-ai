import { describe, it, expect } from 'vitest';
import { renderWizard, type WizardBootstrap } from '../typescript/installer/wizard';
import { defineOrchestration, type OrchestrationInstaller } from '../typescript/installer/define';

const def: OrchestrationInstaller = defineOrchestration({
  installer_name: 'Hello World',
  installer_version: '1.0.0',
  orchestration: {
    orchestration_name: 'o',
    orchestration_description: 'd',
    agents: [{ agent_name: 'a', agent_description: 'd' }],
  },
});

const bootstrap: WizardBootstrap = {
  installerName: 'Hello World',
  installerVersion: '1.0.0',
  requiredScope: 'role_admin',
  apiBaseUrl: 'https://api.orchestration-ai.com',
  oauthClientId: 'client-1',
  oauthRedirectUri: 'http://localhost:3002/install',
  basePath: '',
  plan: [{ kind: 'orchestration', name: 'o' }],
  summary: { agents: 1, layers: 0, settings: 0, files: 0, custom_steps: 0 },
  settings: [],
  customSteps: [],
};

describe('wizard uninstall wiring', () => {
  const html = renderWizard(def, bootstrap);

  it('captures the install record (ids) on the complete event', () => {
    // On completion the client stores the record and derives the workspace id.
    expect(html).toContain('state.installRecord = e.record');
    expect(html).toContain('state.workspaceId = e.record.workspace_id');
  });

  it('sends both workspaceId and orchestrationId from the record on uninstall', () => {
    expect(html).toContain('rec.orchestration_id');
    expect(html).toContain('orchestrationId: orchestrationId');
    // Guards against firing uninstall without the needed ids.
    expect(html).toContain('if (!workspaceId || !orchestrationId)');
  });

  it('wires cross-session manage/discovery mode', () => {
    // Manage entry button + manage panel.
    expect(html).toContain('id="btn-manage"');
    expect(html).toContain('data-step="manage"');
    // OAuth carries the intent; callback branches on it.
    expect(html).toContain("startOAuth('manage')");
    expect(html).toContain("intent === 'manage'");
    // Discovery endpoint is queried and results drive per-install uninstall.
    expect(html).toContain('/api/installs?workspaceId=');
    expect(html).toContain('data-oid=');
  });

  it('wires the LLMs preflight step', () => {
    // A dedicated llms panel + step chip.
    expect(html).toContain('data-step="llms"');
    // Availability endpoint, keys link, refresh + auto-refresh, propagation note.
    expect(html).toContain('/api/llm-availability');
    expect(html).toContain('id="llm-keys-link"');
    expect(html).toContain('id="llm-refresh"');
    expect(html).toContain('id="llm-auto"');
    expect(html).toContain('up to a minute');
    // Step is skipped unless a fallback applies.
    expect(html).toContain('state.llmNeeded');
    expect(html).toContain('checkLlmNeeded');
  });

  it('renders secret settings with a reveal (eye) toggle', () => {
    // Secret inputs start hidden and get a toggle button that flips the type.
    expect(html).toContain('class="secret-input"');
    expect(html).toContain('class="secret-toggle"');
    expect(html).toContain("input.type === 'password'");
    expect(html).toContain("input.type = show ? 'text' : 'password'");
  });
});
