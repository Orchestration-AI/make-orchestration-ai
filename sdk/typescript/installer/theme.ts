// Shared theme for the installer landing page and wizard.
// Tokens extracted from the Orchestration AI website (assets/css/styles.css):
// dark palette, primary teal, teal->green gradient, Inter + JetBrains Mono,
// pill buttons, cards with subtle borders.

/** Google Fonts <link> tags used across installer pages. */
export const FONT_LINKS = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
`;

/** Base CSS: reset, tokens, buttons, header, cards, forms. */
export const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --primary: #40babd;
    --primary-dark: #339597;
    --dark: #0a0e13;
    --dark-2: #10151c;
    --dark-3: #181e27;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --gradient: linear-gradient(135deg, #40babd, #75c181);
    --radius: 16px;
    --radius-sm: 10px;
    --radius-pill: 9999px;
    --border: rgba(255,255,255,0.06);
    --border-strong: rgba(255,255,255,0.12);
    --danger: #f85149;
    --success: #75c181;
  }

  html { scroll-behavior: smooth; }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: var(--dark);
    color: var(--text);
    font-size: 16px;
    line-height: 1.6;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }

  a { color: var(--primary); text-decoration: none; }
  a:hover { color: var(--primary-dark); }

  .container { max-width: 1120px; margin: 0 auto; padding: 0 32px; }
  .container-narrow { max-width: 820px; margin: 0 auto; padding: 0 32px; }

  code, pre, .mono { font-family: 'JetBrains Mono', monospace; }

  /* Header */
  .ins-header {
    position: sticky; top: 0; width: 100%; z-index: 100; padding: 14px 0;
    background: rgba(10, 14, 19, 0.8);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
  }
  .ins-header .container { display: flex; align-items: center; justify-content: space-between; }
  .ins-logo { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; color: var(--text); }
  .ins-logo img { width: 28px; height: 28px; border-radius: 6px; }
  .ins-powered { font-size: 12px; color: var(--text-muted); }
  .ins-powered .highlight { color: var(--primary); }

  /* Buttons */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 13px 28px; border-radius: var(--radius-pill);
    font-size: 14px; font-weight: 500; text-decoration: none;
    transition: all 0.2s; cursor: pointer; border: none;
    font-family: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-primary:hover:not(:disabled) { background: var(--primary-dark); transform: translateY(-1px); box-shadow: 0 8px 32px rgba(64,186,189,0.2); }
  .btn-secondary { background: rgba(255,255,255,0.04); color: var(--text); border: 1px solid var(--border-strong); }
  .btn-secondary:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
  .btn-danger { background: rgba(248,81,73,0.12); color: var(--danger); border: 1px solid rgba(248,81,73,0.3); }
  .btn-danger:hover:not(:disabled) { background: rgba(248,81,73,0.2); }
  .btn-full { width: 100%; }

  /* Cards */
  .card {
    padding: 28px; background: var(--dark-2);
    border: 1px solid var(--border); border-radius: var(--radius);
  }
  .card + .card { margin-top: 16px; }

  /* Eyebrow / headings */
  .eyebrow { font-size: 13px; font-weight: 500; color: var(--primary); margin-bottom: 12px; letter-spacing: 0.02em; }
  h1 { font-size: clamp(30px, 4vw, 48px); font-weight: 300; line-height: 1.2; letter-spacing: -0.025em; }
  h2 { font-size: clamp(24px, 3vw, 34px); font-weight: 300; line-height: 1.25; letter-spacing: -0.015em; }
  h3 { font-size: 16px; font-weight: 600; }
  .muted { color: var(--text-muted); }

  /* Forms */
  label.field { display: block; margin-bottom: 16px; }
  label.field > span { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
  input[type=text], input[type=password], select, textarea {
    width: 100%; font-family: inherit; font-size: 14px; color: var(--text);
    background: var(--dark); border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm); padding: 10px 14px; outline: none;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--primary); }
  input[type=checkbox] { accent-color: var(--primary); width: 16px; height: 16px; }
  .check-field { display: flex; align-items: center; gap: 10px; font-size: 14px; margin-bottom: 16px; }

  /* Pills / badges */
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: var(--radius-pill); background: rgba(64,186,189,0.12); color: var(--primary); }
  .badge-secret { background: rgba(248,81,73,0.12); color: var(--danger); }

  /* Code window */
  .code-window { background: var(--dark-2); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .code-dots { display: flex; gap: 6px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.red { background: #ff5f57; } .dot.yellow { background: #febc2e; } .dot.green { background: #28c840; }
  .code-window pre { padding: 20px 22px; font-size: 12.5px; line-height: 1.8; overflow-x: auto; color: var(--text-muted); }

  footer.ins-footer { border-top: 1px solid var(--border); padding: 28px 0; color: var(--text-muted); font-size: 13px; text-align: center; }
`;

/** Returns a full <head> block with fonts + the given extra CSS. */
export function head(title: string, extraCss = ""): string {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  ${FONT_LINKS}
  <style>${BASE_CSS}${extraCss}</style>
</head>`;
}

/** Minimal HTML escaper for interpolating untrusted definition strings. */
export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
