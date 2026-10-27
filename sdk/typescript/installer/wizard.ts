// Authenticated installer wizard.
//
// A single self-contained HTML app served after the user clicks "Install".
// Steps: consent -> review -> workspace -> custom -> confirm -> apply -> done.
// It talks to the installer server's JSON endpoints and streams apply progress
// over SSE. Styled with the Orchestration AI website theme.
//
// The page is rendered with a bootstrap config (definition summary + OAuth
// parameters) injected as JSON; all step logic runs client-side.

import type { OrchestrationInstaller } from "./define";
import { computeSummary } from "./define";
import { plan } from "./apply";
import { bridgeListenerScript } from "./bridge";
import { head, escapeHtml } from "./theme";

/** Public, non-secret config handed to the wizard's client script. */
export type WizardBootstrap = {
  installerName: string;
  installerVersion: string;
  requiredScope: string;
  apiBaseUrl: string;
  oauthClientId: string;
  oauthRedirectUri: string;
  /** Route prefix the installer is mounted under, e.g. "" or "/install". */
  basePath: string;
  plan: ReturnType<typeof plan>["items"];
  summary: ReturnType<typeof computeSummary>;
  /** Editable default settings grouped for the review screen. */
  settings: Array<{
    agent_name: string;
    setting_name: string;
    setting_description: string;
    setting_type: "Text" | "Boolean" | "Secret";
    default: string | boolean;
    locked: boolean;
  }>;
  customSteps: Array<{ id: string; title: string; description_md?: string }>;
};

const WIZARD_CSS = `
  body { padding-top: 0; }
  .wiz { max-width: 820px; margin: 0 auto; padding: 48px 32px 80px; }

  .steps { display: flex; gap: 8px; margin-bottom: 36px; flex-wrap: wrap; }
  .step-chip { font-size: 12px; color: var(--text-muted); padding: 6px 14px; border-radius: var(--radius-pill); border: 1px solid var(--border); }
  .step-chip.active { color: #fff; background: var(--primary); border-color: var(--primary); }
  .step-chip.done { color: var(--success); border-color: rgba(117,193,129,0.4); }

  .panel { display: none; }
  .panel.active { display: block; }
  .panel h2 { margin-bottom: 8px; }
  .panel > .muted { margin-bottom: 24px; }

  .tree { font-size: 14px; }
  .tree .row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .tree .kind { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); min-width: 92px; }

  .actions { display: flex; justify-content: space-between; margin-top: 28px; gap: 12px; }

  .ws-list label { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px; cursor: pointer; }
  .ws-list label:hover { border-color: var(--border-strong); }

  .step-frame { width: 100%; height: 420px; border: 1px solid var(--border); border-radius: var(--radius); background: #fff; }
  .step-status { font-size: 13px; margin-top: 8px; }
  .step-status.done { color: var(--success); }

  .progress-list .pr { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 14px; border-bottom: 1px solid var(--border); }
  .pr .ic { width: 18px; text-align: center; }
  .pr.done .ic { color: var(--success); }
  .pr.failed .ic { color: var(--danger); }
  .pr.creating .ic { color: var(--primary); }

  .notice { background: rgba(248,81,73,0.08); border: 1px solid rgba(248,81,73,0.25); border-radius: var(--radius-sm); padding: 12px 16px; font-size: 13px; color: var(--text); margin-top: 16px; }

  .secret-input { position: relative; display: flex; align-items: center; }
  .secret-input input { padding-right: 42px; }
  .secret-toggle { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 6px; }
  .secret-toggle:hover { color: var(--text); background: rgba(255,255,255,0.06); }
  .secret-toggle.on { color: var(--primary); }

  .llm-actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
  #llm-list .row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  #llm-list .row:last-child { border-bottom: none; }
  #llm-list .kind { min-width: 150px; color: var(--text-muted); font-size: 12px; }
  .done-icon { font-size: 44px; color: var(--success); }
`;

export function renderWizard(def: OrchestrationInstaller, bootstrap: WizardBootstrap): string {
  // Ordered wizard steps, keyed (not index-numbered) so panels can be inserted
  // without renumbering. The "llms" and "connect" steps are present in the
  // sequence but skipped at runtime when not applicable.
  const stepDefs: Array<{ key: string; label: string }> = [
    { key: "consent", label: "Consent" },
    { key: "review", label: "Review" },
    { key: "workspace", label: "Workspace" },
    { key: "llms", label: "LLMs" },
  ];
  if ((def.customSteps ?? []).length) stepDefs.push({ key: "connect", label: "Connect" });
  stepDefs.push({ key: "confirm", label: "Confirm" });
  stepDefs.push({ key: "apply", label: "Applying" });
  stepDefs.push({ key: "done", label: "Done" });

  const stepChips = stepDefs
    .map((s) => `<div class="step-chip" data-step="${s.key}">${escapeHtml(s.label)}</div>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
${head(`Install ${def.installer_name}`, WIZARD_CSS)}
<body>
  <header class="ins-header">
    <div class="container">
      <div class="ins-logo"><span>${escapeHtml(def.installer_name)}</span></div>
      <span class="ins-powered">Powered by <span class="highlight">Orchestration</span>AI</span>
    </div>
  </header>

  <div class="wiz">
    <div class="steps">${stepChips}</div>

    <!-- Consent -->
    <section class="panel" data-step="consent">
      <h2>Authorize installation</h2>
      <p class="muted">To install <strong>${escapeHtml(def.installer_name)}</strong> you'll sign in to
        Orchestration AI and grant <code>${escapeHtml(bootstrap.requiredScope)}</code> access. You choose
        the workspace next.</p>
      <div class="actions">
        <button class="btn btn-secondary" id="btn-manage">Manage an existing installation</button>
        <button class="btn btn-primary" id="btn-consent">Continue to sign in</button>
      </div>
    </section>

    <!-- Manage existing installs -->
    <section class="panel" data-step="manage">
      <h2>Manage installations</h2>
      <p class="muted">Pick a workspace to find existing installations of ${escapeHtml(def.installer_name)}.</p>
      <div class="ws-list" id="manage-ws-list"></div>
      <div id="installs-list" style="margin-top:16px"></div>
    </section>

    <!-- Review -->
    <section class="panel" data-step="review">
      <h2>Review what will be installed</h2>
      <p class="muted">Default settings are editable. Nothing is created until you confirm.</p>
      <div class="card tree" id="review-tree"></div>
      <div class="card" id="review-settings" style="margin-top:16px"></div>
      <div class="actions"><button class="btn btn-secondary" data-back>Back</button><button class="btn btn-primary" data-next>Continue</button></div>
    </section>

    <!-- Workspace -->
    <section class="panel" data-step="workspace">
      <h2>Choose a workspace</h2>
      <p class="muted">Install into an existing workspace, or create a new one.</p>
      <div class="ws-list" id="ws-list"></div>
      <label class="field"><span>Or create a new workspace</span>
        <input type="text" id="ws-new" placeholder="New workspace name" /></label>
      <div class="actions"><button class="btn btn-secondary" data-back>Back</button><button class="btn btn-primary" data-next id="ws-continue">Continue</button></div>
    </section>

    <!-- LLMs preflight (shown only when a fallback would apply) -->
    <section class="panel" data-step="llms">
      <h2>Language models</h2>
      <p class="muted">Some layers request an LLM you don't have yet. You can continue with the
        fallback shown, or load the required keys and refresh.</p>
      <div class="card" id="llm-list"></div>
      <div class="llm-actions">
        <a class="btn btn-secondary" id="llm-keys-link" target="_blank" rel="noopener">Load LLM keys ↗</a>
        <label class="check-field" style="margin:0"><input type="checkbox" id="llm-auto" checked /> Auto-refresh</label>
        <button class="btn btn-secondary" id="llm-refresh">Refresh</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">After loading keys it can take up to a minute for new models to appear.</p>
      <div class="actions"><button class="btn btn-secondary" data-back>Back</button><button class="btn btn-primary" data-next>Continue</button></div>
    </section>

    ${(def.customSteps ?? []).length ? `
    <!-- Custom steps -->
    <section class="panel" data-step="connect">
      <h2>Connect services</h2>
      <p class="muted">Complete each setup step below. They may open third-party authorization.</p>
      <div id="custom-steps"></div>
      <div class="actions"><button class="btn btn-secondary" data-back>Back</button><button class="btn btn-primary" data-next>Continue</button></div>
    </section>` : ""}

    <!-- Confirm -->
    <section class="panel" data-step="confirm">
      <h2>Confirm installation</h2>
      <p class="muted">Review the final summary before installing.</p>
      <div class="card" id="confirm-summary"></div>
      <div class="notice" id="secret-notice" style="display:none">Some settings include secrets that will be stored securely in your workspace.</div>
      <div class="actions"><button class="btn btn-secondary" data-back>Back</button><button class="btn btn-primary" id="btn-install">Install now</button></div>
    </section>

    <!-- Apply -->
    <section class="panel" data-step="apply">
      <h2>Installing…</h2>
      <div class="card progress-list" id="progress"></div>
    </section>

    <!-- Done -->
    <section class="panel" data-step="done">
      <div style="text-align:center;padding:24px 0">
        <div class="done-icon">✓</div>
        <h2 style="margin-top:12px">Installed</h2>
        <p class="muted" id="done-msg">${escapeHtml(def.installer_name)} is ready in your workspace.</p>
        <div class="actions" style="justify-content:center;margin-top:24px">
          <button class="btn btn-danger" id="btn-uninstall">Uninstall</button>
        </div>
      </div>
    </section>
  </div>

  <script>window.__OAI_BOOTSTRAP__ = ${JSON.stringify(bootstrap)};</script>
  <script>${bridgeListenerScript()}</script>
  <script>${wizardClientScript()}</script>
</body>
</html>`;
}

/** The client-side controller for the wizard. Returned as a string of JS. */
function wizardClientScript(): string {
  return `
(function () {
  var cfg = window.__OAI_BOOTSTRAP__;
  var EYE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var hasCustom = cfg.customSteps.length > 0;
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.step-chip'));
  // Ordered step keys from the chip bar (manage is not a chip).
  var stepKeys = chips.map(function (c) { return c.dataset.step; });
  var state = { token: null, workspaceId: null, createWorkspaceName: null, settings: [], stepResults: {}, installRecord: null, llmNeeded: false, llmTimer: null };

  function show(key) {
    panels.forEach(function (p) { p.classList.toggle('active', p.dataset.step === key); });
    var idx = stepKeys.indexOf(key);
    chips.forEach(function (c, ci) {
      c.classList.toggle('active', c.dataset.step === key);
      c.classList.toggle('done', idx >= 0 && ci < idx);
    });
    // Stop LLM auto-refresh whenever we leave the llms step.
    if (key !== 'llms' && state.llmTimer) { clearInterval(state.llmTimer); state.llmTimer = null; }
    window.scrollTo(0, 0);
  }
  function panelStep(el) { return el.closest('.panel').dataset.step; }

  // The next step after the given key, skipping steps that don't apply at
  // runtime: the llms step is skipped unless a fallback would apply for this
  // user, and connect only exists when the installer has custom steps.
  function nextStep(key) {
    var i = stepKeys.indexOf(key);
    for (var j = i + 1; j < stepKeys.length; j++) {
      var k = stepKeys[j];
      if (k === 'llms' && !state.llmNeeded) continue;
      return k;
    }
    return null;
  }
  function prevStep(key) {
    var i = stepKeys.indexOf(key);
    for (var j = i - 1; j >= 0; j--) {
      var k = stepKeys[j];
      if (k === 'llms' && !state.llmNeeded) continue;
      return k;
    }
    return null;
  }

  // Seed editable settings from defaults.
  state.settings = cfg.settings.map(function (s) {
    return { agent_name: s.agent_name, setting_name: s.setting_name, setting_description: s.setting_description,
             setting_type: s.setting_type, value: s.default != null ? s.default : (s.setting_type === 'Boolean' ? false : '') };
  });

  // ---- OAuth consent ----
  function startOAuth(intent) {
    var params = new URLSearchParams({
      response_type: 'code', client_id: cfg.oauthClientId,
      redirect_uri: cfg.oauthRedirectUri, scope: cfg.requiredScope, state: intent
    });
    window.location.href = cfg.apiBaseUrl + '/oauth/ui/authorize?' + params.toString();
  }
  document.getElementById('btn-consent').addEventListener('click', function () { startOAuth('install'); });
  document.getElementById('btn-manage').addEventListener('click', function () { startOAuth('manage'); });

  // Handle OAuth callback (?code=...): exchange server-side, then route by the
  // state param — fresh install vs. managing existing installations.
  (function handleCallback() {
    var qs = new URLSearchParams(window.location.search);
    var code = qs.get('code');
    if (!code) return;
    var intent = qs.get('state') || 'install';
    fetch(cfg.basePath + '/api/auth/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, redirect_uri: cfg.oauthRedirectUri })
    }).then(function (r) { return r.json(); }).then(function (t) {
      if (!t.access_token) return;
      state.token = t.access_token;
      history.replaceState({}, '', window.location.pathname);
      if (intent === 'manage') {
        showManage();
        loadManageWorkspaces();
      } else {
        renderReview();
        loadWorkspaces();
        show('review');
      }
    });
  })();

  // ---- Manage existing installs ----
  function showManage() {
    panels.forEach(function (p) { p.classList.toggle('active', p.dataset.step === 'manage'); });
    chips.forEach(function (c) { c.classList.remove('active', 'done'); });
    window.scrollTo(0, 0);
  }
  function loadManageWorkspaces() {
    fetch(cfg.basePath + '/api/workspaces', { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = document.getElementById('manage-ws-list');
        list.innerHTML = (data.workspaces || []).map(function (w) {
          return '<label><input type="radio" name="mws" value="' + escapeHtml(w.id) + '"/> ' + escapeHtml(w.workspace_name) + '</label>';
        }).join('') || '<p class="muted">No workspaces found.</p>';
        list.querySelectorAll('input[name=mws]').forEach(function (r) {
          r.addEventListener('change', function () { loadInstalls(r.value); });
        });
      });
  }
  function loadInstalls(workspaceId) {
    var host = document.getElementById('installs-list');
    host.innerHTML = '<p class="muted">Searching…</p>';
    fetch(cfg.basePath + '/api/installs?workspaceId=' + encodeURIComponent(workspaceId), { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var installs = data.installs || [];
        if (!installs.length) { host.innerHTML = '<p class="muted">No installations of ' + escapeHtml(cfg.installerName) + ' in this workspace.</p>'; return; }
        host.innerHTML = installs.map(function (it) {
          return '<div class="card" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">' +
            '<div><strong>' + escapeHtml(it.orchestration_name) + '</strong>' +
            '<div class="muted" style="font-size:12px">v' + escapeHtml(it.installer_version) + ' · installed ' + escapeHtml((it.installed_at || '').slice(0, 10)) + '</div></div>' +
            '<button class="btn btn-danger" data-oid="' + escapeHtml(it.orchestration_id) + '" data-wid="' + escapeHtml(workspaceId) + '">Uninstall</button></div>';
        }).join('');
        host.querySelectorAll('button[data-oid]').forEach(function (b) {
          b.addEventListener('click', function () { doUninstall(b.dataset.wid, b.dataset.oid, b); });
        });
      });
  }
  function doUninstall(workspaceId, orchestrationId, btn) {
    if (!confirm('Uninstall ' + cfg.installerName + '? This removes the orchestration and any connected services.')) return;
    btn.disabled = true; btn.textContent = 'Uninstalling…';
    fetch(cfg.basePath + '/api/uninstall', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token: state.token, workspaceId: workspaceId, orchestrationId: orchestrationId }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) { var row = btn.closest('.card'); if (row) row.remove(); }
        else { btn.disabled = false; btn.textContent = 'Uninstall'; alert('Uninstall failed: ' + (res.error || '')); }
      });
  }

  function authHeaders(extra) {
    var h = extra || {};
    if (state.token) h['Authorization'] = 'Bearer ' + state.token;
    return h;
  }

  // ---- Review ----
  function renderReview() {
    var tree = document.getElementById('review-tree');
    tree.innerHTML = cfg.plan.map(function (it) {
      return '<div class="row"><span class="kind">' + it.kind + '</span><span>' + escapeHtml(it.name) + '</span></div>';
    }).join('');

    var box = document.getElementById('review-settings');
    if (!state.settings.length) { box.style.display = 'none'; return; }
    box.innerHTML = '<h3 style="margin-bottom:12px">Default settings</h3>' + state.settings.map(function (s, i) {
      var label = escapeHtml(s.agent_name) + ' · ' + escapeHtml(s.setting_name) +
        (s.setting_type === 'Secret' ? ' <span class="badge badge-secret">secret</span>' : '');
      var locked = cfg.settings[i].locked ? 'disabled' : '';
      if (s.setting_type === 'Boolean') {
        return '<div class="check-field"><input type="checkbox" data-si="' + i + '" ' + (s.value ? 'checked' : '') + ' ' + locked + '/> ' + label + '</div>';
      }
      if (s.setting_type === 'Secret') {
        return '<label class="field"><span>' + label + '</span>' +
          '<div class="secret-input"><input type="password" data-si="' + i + '" value="' + escapeHtml(s.value) + '" ' + locked + '/>' +
          '<button type="button" class="secret-toggle" data-toggle="' + i + '" aria-label="Show secret" title="Show secret">' + EYE_ICON + '</button></div></label>';
      }
      return '<label class="field"><span>' + label + '</span><input type="text" data-si="' + i + '" value="' + escapeHtml(s.value) + '" ' + locked + '/></label>';
    }).join('');
    box.querySelectorAll('[data-si]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.dataset.si);
        state.settings[i].value = inp.type === 'checkbox' ? inp.checked : inp.value;
      });
    });
    // Eye toggle: reveal/hide secret values without changing stored state.
    box.querySelectorAll('.secret-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = btn.parentNode.querySelector('input');
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.classList.toggle('on', show);
        btn.setAttribute('aria-label', show ? 'Hide secret' : 'Show secret');
        btn.setAttribute('title', show ? 'Hide secret' : 'Show secret');
      });
    });
  }

  // ---- Workspaces ----
  function loadWorkspaces() {
    fetch(cfg.basePath + '/api/workspaces', { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = document.getElementById('ws-list');
        list.innerHTML = (data.workspaces || []).map(function (w) {
          return '<label><input type="radio" name="ws" value="' + escapeHtml(w.id) + '"/> ' + escapeHtml(w.workspace_name) + '</label>';
        }).join('') || '<p class="muted">No existing workspaces. Create one below.</p>';
        list.querySelectorAll('input[name=ws]').forEach(function (r) {
          r.addEventListener('change', function () { state.workspaceId = r.value; state.createWorkspaceName = null; document.getElementById('ws-new').value = ''; });
        });
      });
  }
  document.getElementById('ws-new').addEventListener('input', function (e) {
    state.createWorkspaceName = e.target.value.trim() || null;
    if (state.createWorkspaceName) { state.workspaceId = null; document.querySelectorAll('input[name=ws]').forEach(function (r) { r.checked = false; }); }
  });

  // ---- Custom steps ----
  window.__oaiReceiveStepResult = function (stepId, result) {
    state.stepResults[stepId] = result;
    var s = document.getElementById('status-' + stepId);
    if (s) { s.textContent = '✓ Connected'; s.classList.add('done'); }
  };
  function renderCustomSteps() {
    if (!hasCustom) return;
    var host = document.getElementById('custom-steps');
    host.innerHTML = cfg.customSteps.map(function (st) {
      return '<div class="card" style="margin-bottom:16px"><h3>' + escapeHtml(st.title) + '</h3>' +
        (st.description_md ? '<p class="muted">' + escapeHtml(st.description_md) + '</p>' : '') +
        '<iframe class="step-frame" src="' + cfg.basePath + '/steps/' + encodeURIComponent(st.id) + '"></iframe>' +
        '<div class="step-status" id="status-' + st.id + '">Not connected</div></div>';
    }).join('');
  }

  // ---- LLMs preflight ----
  var llmLoaded = false;
  function initLlmStep() {
    document.getElementById('llm-refresh').addEventListener('click', loadLlmAvailability);
    document.getElementById('llm-auto').addEventListener('change', function (e) {
      if (e.target.checked) startLlmAuto(); else stopLlmAuto();
    });
    loadLlmAvailability();
    if (document.getElementById('llm-auto').checked) startLlmAuto();
  }
  function startLlmAuto() {
    stopLlmAuto();
    // LLMs can take up to ~1 min to appear after keys are loaded; poll every 8s.
    state.llmTimer = setInterval(loadLlmAvailability, 8000);
  }
  function stopLlmAuto() { if (state.llmTimer) { clearInterval(state.llmTimer); state.llmTimer = null; } }

  function loadLlmAvailability() {
    var wid = state.workspaceId;
    var link = document.getElementById('llm-keys-link');
    var host = document.getElementById('llm-list');
    return fetch(cfg.basePath + '/api/llm-availability', { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (report) {
        link.href = report.llmKeysUrl || 'https://console.orchestration-ai.com/llm-keys';
        var layers = report.layers || [];
        if (!layers.length) { host.innerHTML = '<p class="muted">No specific LLMs requested.</p>'; return report; }
        host.innerHTML = layers.map(function (l) {
          var ok = l.available;
          var badge = ok
            ? '<span class="badge">available</span>'
            : '<span class="badge badge-secret">fallback</span>';
          var detail;
          if (ok) {
            detail = 'Using <code>' + escapeHtml(l.effective) + '</code>';
          } else if (l.requested) {
            detail = 'Requested <code>' + escapeHtml(l.requested) + '</code> → using <code>' + escapeHtml(l.effective) + '</code>';
          } else {
            detail = 'Default model → using <code>' + escapeHtml(l.effective) + '</code>';
          }
          return '<div class="row"><span class="kind">' + escapeHtml(l.agent_name) + '/' + escapeHtml(l.layer_name) + '</span>' +
            '<span>' + detail + '</span>' + badge + '</div>';
        }).join('');
        return report;
      })
      .catch(function () { host.innerHTML = '<p class="muted">Could not check LLM availability.</p>'; });
  }

  // Determine whether the LLMs step is needed (any fallback) before navigating
  // past the workspace step. Resolves to a boolean.
  function checkLlmNeeded() {
    return fetch(cfg.basePath + '/api/llm-availability', { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (report) { state.llmNeeded = !!(report && report.anyFallback); return state.llmNeeded; })
      .catch(function () { state.llmNeeded = false; return false; });
  }

  // ---- Confirm ----
  function renderConfirm() {
    var el = document.getElementById('confirm-summary');
    var s = cfg.summary;
    el.innerHTML = '<p>' + s.agents + ' agents · ' + s.layers + ' layers · ' + s.settings + ' settings · ' + s.files + ' files</p>' +
      '<p class="muted" style="margin-top:8px">Target: ' + (state.createWorkspaceName ? ('new workspace “' + escapeHtml(state.createWorkspaceName) + '”') : 'selected workspace') + '</p>';
    var hasSecret = state.settings.some(function (x) { return x.setting_type === 'Secret'; }) ||
      Object.keys(state.stepResults).length > 0;
    document.getElementById('secret-notice').style.display = hasSecret ? 'block' : 'none';
  }

  // ---- Apply (SSE) ----
  document.getElementById('btn-install').addEventListener('click', function () {
    show('apply');
    var prog = document.getElementById('progress');
    prog.innerHTML = '';
    var stepResults = Object.keys(state.stepResults).map(function (id) { return { stepId: id, result: state.stepResults[id] }; });
    fetch(cfg.basePath + '/api/apply', {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token: state.token, workspaceId: state.workspaceId, createWorkspaceName: state.createWorkspaceName, settings: state.settings, stepResults: stepResults })
    }).then(function (res) {
      var reader = res.body.getReader(); var dec = new TextDecoder(); var buf = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buf += dec.decode(chunk.value, { stream: true });
          var parts = buf.split('\\n\\n'); buf = parts.pop();
          parts.forEach(function (p) {
            var line = p.replace(/^data: /, ''); if (!line) return;
            try { onProgress(JSON.parse(line)); } catch (e) {}
          });
          return pump();
        });
      }
      return pump();
    });
  });

  function rowId(e) { return (e.kind + ':' + (e.name || '')).replace(/[^a-z0-9]/gi, '_'); }
  function onProgress(e) {
    var prog = document.getElementById('progress');
    if (e.phase === 'resource') {
      var id = rowId(e); var row = document.getElementById(id);
      if (!row) { row = document.createElement('div'); row.className = 'pr'; row.id = id;
        row.innerHTML = '<span class="ic">○</span><span>' + e.kind + ' · ' + escapeHtml(e.name) + '</span>'; prog.appendChild(row); }
      row.className = 'pr ' + e.status;
      row.querySelector('.ic').textContent = e.status === 'done' ? '✓' : (e.status === 'failed' ? '✕' : '…');
    } else if (e.phase === 'hook') {
      var hid = 'hook_' + e.name; var hrow = document.getElementById(hid);
      if (!hrow) { hrow = document.createElement('div'); hrow.className = 'pr'; hrow.id = hid;
        var label = e.name === 'onInstalled' ? 'Post-install' : e.name;
        hrow.innerHTML = '<span class="ic">○</span><span>' + escapeHtml(label) + '</span>'; prog.appendChild(hrow); }
      hrow.className = 'pr ' + (e.status === 'running' ? 'creating' : e.status);
      hrow.querySelector('.ic').textContent = e.status === 'done' ? '✓' : (e.status === 'failed' ? '✕' : '…');
    } else if (e.phase === 'complete') {
      // Capture the resulting ids (esp. for a newly created workspace) so
      // uninstall can target the right orchestration.
      if (e.record) {
        state.installRecord = e.record;
        state.workspaceId = e.record.workspace_id;
      }
      show('done');
    } else if (e.phase === 'error') {
      var d = document.createElement('div'); d.className = 'notice'; d.textContent = 'Error: ' + e.message; prog.appendChild(d);
    }
  }

  // ---- Uninstall ----
  document.getElementById('btn-uninstall').addEventListener('click', function () {
    if (!confirm('Uninstall ' + cfg.installerName + '? This removes the orchestration and any connected services.')) return;
    var rec = state.installRecord || {};
    var workspaceId = rec.workspace_id || state.workspaceId;
    var orchestrationId = rec.orchestration_id;
    if (!workspaceId || !orchestrationId) {
      document.getElementById('done-msg').textContent = 'Uninstall unavailable: install details not found.';
      return;
    }
    fetch(cfg.basePath + '/api/uninstall', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token: state.token, workspaceId: workspaceId, orchestrationId: orchestrationId }) })
      .then(function (r) { return r.json(); })
      .then(function (res) { document.getElementById('done-msg').textContent = res.ok ? 'Uninstalled.' : ('Uninstall failed: ' + (res.error || '')); });
  });

  // ---- Nav wiring ----
  // Run the right initialisation when arriving at a step, then show it.
  function enter(key) {
    if (key === 'llms') initLlmStep();
    else if (key === 'connect') renderCustomSteps();
    else if (key === 'confirm') renderConfirm();
    show(key);
  }
  document.querySelectorAll('[data-next]').forEach(function (b) {
    b.addEventListener('click', function () {
      var from = panelStep(b);
      if (from === 'workspace' && !state.workspaceId && !state.createWorkspaceName) {
        alert('Select or name a workspace.'); return;
      }
      if (from === 'workspace') {
        // Decide whether the LLMs step applies for this user before routing.
        b.disabled = true;
        checkLlmNeeded().then(function () { b.disabled = false; enter(nextStep(from)); });
        return;
      }
      enter(nextStep(from));
    });
  });
  document.querySelectorAll('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () { enter(prevStep(panelStep(b))); });
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  show('consent');
})();
`;
}
