import { describe, it, expect } from 'vitest';
import { renderLanding } from '../typescript/installer/landing';
import { defineOrchestration, type OrchestrationInstaller } from '../typescript/installer/define';

const withDescription = (description_md: string): OrchestrationInstaller =>
  defineOrchestration({
    installer_name: 'Sales Copilot',
    installer_version: '1.0.0',
    description_md,
    orchestration: {
      orchestration_name: 'o',
      orchestration_description: 'd',
      agents: [{ agent_name: 'a', agent_description: 'd' }],
    },
  });

describe('renderLanding markdown (About section)', () => {
  it('renders an unordered list with bold items', () => {
    const md = [
      'Sales Copilot installs a two-agent orchestration into your workspace:',
      '',
      '- a **Triage** agent that classifies inbound leads, and',
      '- a **Follow-up** agent that drafts personalised replies.',
      '',
      'You connect your CRM during setup.',
    ].join('\n');

    const html = renderLanding(withDescription(md), '/install');

    // Paragraph before the list.
    expect(html).toContain('<p>Sales Copilot installs a two-agent orchestration into your workspace:</p>');
    // A real list, not literal dashes.
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a <strong>Triage</strong> agent that classifies inbound leads, and</li>');
    expect(html).toContain('<li>a <strong>Follow-up</strong> agent that drafts personalised replies.</li>');
    // Trailing paragraph.
    expect(html).toContain('<p>You connect your CRM during setup.</p>');
    // No leftover literal bullet markers in the About markup.
    expect(html).not.toContain('<p>- a **Triage**');
  });

  it('renders headings, italics, and inline code', () => {
    const md = '# Overview\n\nUses *layers* and `services`.';
    const html = renderLanding(withDescription(md), '/install');
    expect(html).toContain('<h3>Overview</h3>');
    expect(html).toContain('<em>layers</em>');
    expect(html).toContain('<code>services</code>');
  });

  it('escapes raw HTML before applying formatting (injection-safe)', () => {
    const md = 'Hello <script>alert(1)</script> **world**';
    const html = renderLanding(withDescription(md), '/install');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>world</strong>');
  });
});

describe('renderLanding media', () => {
  it('renders a screenshots gallery and the publisher logo', () => {
    const def = defineOrchestration({
      installer_name: 'Hello World',
      installer_version: '1.0.0',
      publisher: { name: 'ACME', logo_url: '/assets/logo.svg' },
      screenshots: [
        'https://images.pexels.com/photos/1/a.jpeg?w=800',
        'https://images.pexels.com/photos/2/b.jpeg?w=800',
      ],
      orchestration: {
        orchestration_name: 'o',
        orchestration_description: 'd',
        agents: [{ agent_name: 'a', agent_description: 'd' }],
      },
    });
    const html = renderLanding(def, '/install');
    expect(html).toContain('class="gallery"');
    expect(html).toContain('src="https://images.pexels.com/photos/1/a.jpeg?w=800"');
    expect(html).toContain('src="https://images.pexels.com/photos/2/b.jpeg?w=800"');
    expect(html).toContain('src="/assets/logo.svg"');
  });

  it('omits the gallery when there are no screenshots', () => {
    const def = defineOrchestration({
      installer_name: 'Hello World',
      installer_version: '1.0.0',
      orchestration: {
        orchestration_name: 'o',
        orchestration_description: 'd',
        agents: [{ agent_name: 'a', agent_description: 'd' }],
      },
    });
    const html = renderLanding(def, '/install');
    expect(html).not.toContain('class="gallery"');
  });
});
