// Public landing page for an installer.
//
// Rendered at the installer root (the "install link" developers advertise).
// A visitor can understand the product BEFORE authenticating. Styled with the
// Orchestration AI website theme. The "Install" CTA links to the wizard, which
// begins the OAuth consent flow.

import type { OrchestrationInstaller } from "./define";
import { computeSummary } from "./define";
import { head, escapeHtml } from "./theme";

const LANDING_CSS = `
  main { padding-top: 0; }

  .hero { padding: 100px 0 72px; }
  .hero .container { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 56px; align-items: center; }
  @media (max-width: 860px) { .hero .container { grid-template-columns: 1fr; } }
  .hero h1 { margin-bottom: 18px; }
  .hero .tagline { font-size: 18px; color: var(--text-muted); font-weight: 300; margin-bottom: 28px; max-width: 520px; }
  .hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }

  .struct-preview .code-window pre { white-space: pre; }
  .struct-preview .agent { color: var(--text); }
  .struct-preview .leaf { color: var(--text-muted); }
  .struct-preview .kw { color: var(--primary); }

  section.block { padding: 64px 0; border-top: 1px solid var(--border); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }

  .summary-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
  .summary-pill { background: var(--dark-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 18px; min-width: 110px; }
  .summary-pill .n { font-size: 24px; font-weight: 600; color: var(--primary); }
  .summary-pill .l { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .highlight-card .pc-icon { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; background: rgba(64,186,189,0.08); border-radius: 9px; margin-bottom: 14px; color: var(--primary); }
  .md p { margin-bottom: 14px; color: var(--text-muted); font-weight: 300; }
  .md ul { margin: 0 0 14px 1.2em; color: var(--text-muted); font-weight: 300; }
  .md li { margin-bottom: 6px; }
  .md h3, .md h4, .md h5, .md h6 { color: var(--text); margin: 20px 0 10px; }
  .md strong { color: var(--text); font-weight: 600; }
  .md code { font-family: 'JetBrains Mono', monospace; font-size: 0.9em; background: var(--dark-3); padding: 1px 6px; border-radius: 4px; }

  .trust { display: flex; align-items: center; gap: 16px; }
  .trust img { width: 44px; height: 44px; border-radius: 10px; }

  .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .gallery .shot { width: 100%; height: 180px; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border); }
`;

/** Render a minimal, safe orchestration-structure preview for the hero. */
function structurePreview(def: OrchestrationInstaller): string {
  const orch = def.orchestration;
  const lines: string[] = [];
  lines.push(`<span class="kw">orchestration</span> ${escapeHtml(orch.orchestration_name)}`);
  for (const agent of orch.agents ?? []) {
    lines.push(`  <span class="agent">▸ agent</span> ${escapeHtml(agent.agent_name)}`);
    for (const l of agent.layers ?? []) {
      lines.push(`      <span class="leaf">layer</span> ${escapeHtml(l.layer_name)}`);
    }
    const settingCount = (agent.settings ?? []).length;
    if (settingCount) lines.push(`      <span class="leaf">${settingCount} setting${settingCount !== 1 ? "s" : ""}</span>`);
  }
  return lines.join("\n");
}

/**
 * Small, safe markdown renderer for `description_md`. Handles the common subset
 * used in installer descriptions: headings, unordered lists, bold, italic, and
 * inline code. All text is HTML-escaped BEFORE any tags are inserted, so raw
 * HTML in an untrusted definition cannot inject markup.
 */
function renderDescription(md: string): string {
  // Inline formatting applied to already-escaped text.
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const lines = md.split("\n");
  const out: string[] = [];
  let listItems: string[] = [];
  let paragraph: string[] = [];

  const flushList = () => {
    if (listItems.length) {
      out.push(`<ul>${listItems.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
      listItems = [];
    }
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      // Blank line ends the current block.
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 2, 6); // #->h3, ## ->h4, ...
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
    } else {
      // Plain text line: part of the current paragraph. A list in progress ends.
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return out.join("");
}

/**
 * Render the landing page. `wizardPath` is where the Install CTA points
 * (the authenticated wizard entrypoint).
 */
export function renderLanding(def: OrchestrationInstaller, wizardPath: string): string {
  const computed = computeSummary(def);
  const summary = { ...computed, ...(def.install_summary ?? {}) };
  const publisher = def.publisher;
  const scope = def.required_scope ?? "role_admin";

  const highlights = (def.highlights ?? []).map(
    (h) => `
    <div class="card highlight-card">
      <div class="pc-icon">✓</div>
      <h3>${escapeHtml(h)}</h3>
    </div>`
  ).join("");

  const summaryPills = [
    { n: summary.agents, l: "Agents" },
    { n: summary.layers, l: "Layers" },
    { n: summary.settings, l: "Settings" },
    { n: summary.files, l: "Files" },
    { n: summary.custom_steps, l: "Setup steps" },
  ].filter((p) => p.n > 0)
    .map((p) => `<div class="summary-pill"><div class="n">${p.n}</div><div class="l">${p.l}</div></div>`)
    .join("");

  const gallery = (def.screenshots ?? [])
    .map((src) => `<img class="shot" src="${escapeHtml(src)}" alt="" loading="lazy" />`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
${head(`Install ${def.installer_name}`, LANDING_CSS)}
<body>
  <header class="ins-header">
    <div class="container">
      <div class="ins-logo">
        ${publisher?.logo_url ? `<img src="${escapeHtml(publisher.logo_url)}" alt="" />` : ""}
        <span>${escapeHtml(def.installer_name)}</span>
      </div>
      <span class="ins-powered">Powered by <span class="highlight">Orchestration</span>AI</span>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="container">
        <div class="hero-text">
          <div class="eyebrow">${escapeHtml(publisher?.name ? `by ${publisher.name}` : "Orchestration installer")}</div>
          <h1>${escapeHtml(def.installer_name)}</h1>
          <p class="tagline">${escapeHtml(def.tagline ?? def.orchestration.orchestration_description)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="${escapeHtml(wizardPath)}">Install</a>
            <a class="btn btn-secondary" href="#details">Learn more</a>
          </div>
        </div>
        <div class="struct-preview">
          <div class="code-window">
            <div class="code-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
            <pre><code>${structurePreview(def)}</code></pre>
          </div>
        </div>
      </div>
    </section>

    ${summaryPills ? `
    <section class="block" id="details">
      <div class="container">
        <div class="eyebrow">What you'll install</div>
        <h2>One orchestration, ready to run.</h2>
        <div class="summary-row">${summaryPills}</div>
      </div>
    </section>` : ""}

    ${highlights ? `
    <section class="block">
      <div class="container">
        <div class="eyebrow">Highlights</div>
        <div class="grid">${highlights}</div>
      </div>
    </section>` : ""}

    ${gallery ? `
    <section class="block">
      <div class="container">
        <div class="eyebrow">Screenshots</div>
        <div class="gallery">${gallery}</div>
      </div>
    </section>` : ""}

    ${def.description_md ? `
    <section class="block">
      <div class="container-narrow md">
        <div class="eyebrow">About</div>
        ${renderDescription(def.description_md)}
      </div>
    </section>` : ""}

    <section class="block">
      <div class="container-narrow">
        <div class="eyebrow">Permissions &amp; data</div>
        <div class="card">
          <p class="muted">Installing grants this installer <code>${escapeHtml(scope)}</code> access to a
          workspace <strong>you choose</strong> (existing or new). It will create the orchestration shown
          above.${summary.custom_steps > 0 ? " Some setup steps may connect third-party services you authorize; those connections can be removed on uninstall." : ""}</p>
          <p class="muted">You review everything and confirm before anything is created.</p>
        </div>
      </div>
    </section>

    ${publisher ? `
    <section class="block">
      <div class="container-narrow">
        <div class="eyebrow">Publisher</div>
        <div class="trust">
          ${publisher.logo_url ? `<img src="${escapeHtml(publisher.logo_url)}" alt="" />` : ""}
          <div>
            <h3>${escapeHtml(publisher.name)}</h3>
            ${publisher.url ? `<a href="${escapeHtml(publisher.url)}" target="_blank" rel="noopener">${escapeHtml(publisher.url)}</a>` : ""}
            <div class="muted" style="font-size:13px;margin-top:4px">Version ${escapeHtml(def.installer_version)}</div>
          </div>
        </div>
      </div>
    </section>` : ""}
  </main>

  <footer class="ins-footer">
    <div class="container">Orchestration installer · v${escapeHtml(def.installer_version)}</div>
  </footer>
</body>
</html>`;
}
