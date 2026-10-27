# Sales Copilot installer (example)

A standalone example Orchestration AI installer built with
`@orchestration-ai/sdk/installer`. It demonstrates every feature of the
framework:

- a multi-agent orchestration (`triage` + `follow-up`) with layers and services,
- agent-scoped settings including a `Secret`,
- OAI files at orchestration and agent scope,
- a custom third-party step (`connect-crm`) that emits a Secret setting and
  cleans up on uninstall,
- a public landing page and an install/uninstall wizard.

## Files

| File | Purpose |
|------|---------|
| `sales-copilot.installer.ts` | The orchestration definition. |
| `install.ts` | Server entrypoint (`createInstaller(...).listen()`). |
| `custom-steps/connect-crm.ts` | CRM connection step: callback route + uninstall hook. |
| `custom-steps/connect-crm.html` | The step's in-wizard UI. |

## Run

```bash
npm install

export INSTALLER_OAUTH_CLIENT_ID=...
export INSTALLER_OAUTH_CLIENT_SECRET=...
export INSTALLER_OAUTH_REDIRECT_URI=http://localhost:3002/install

npm start
```

Open http://localhost:3002/ for the landing page, then click **Install**.

## Scaffolding your own

```bash
npx @orchestration-ai/create-installer "My Installer" --custom-step
```
