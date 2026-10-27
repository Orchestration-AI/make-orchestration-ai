# Hello World installer

A minimal but complete Orchestration AI installer. Visitors open the install
link, see a landing page describing what will be installed, authorize with
`role_admin`, pick (or create) a workspace, and apply.

This example demonstrates:

- an installer **icon** (`assets/logo.svg`, served at `/assets/logo.svg`),
- a **screenshot gallery** on the landing page (public Pexels images),
- **lifecycle hooks** (`onInstalled` / `onUninstalled`) that log,
- a single agent with one layer and an editable `greeting` setting.

## Files

- `hello-world.installer.ts` — the orchestration definition + lifecycle hooks.
- `install.ts` — the server entrypoint (`createInstaller(...).listen()`), wiring `assetsDir`.
- `assets/logo.svg` — the installer icon (`publisher.logo_url`).

## Running

```bash
export INSTALLER_OAUTH_CLIENT_ID=...
export INSTALLER_OAUTH_CLIENT_SECRET=...
export INSTALLER_OAUTH_REDIRECT_URI=http://localhost:3002/install

npm install
npm start      # builds the local SDK, then runs install.ts
```

Open http://localhost:3002/ for the landing page (icon + screenshots), then
click **Install**. The `onInstalled` / `onUninstalled` hooks log to the server
console on apply / uninstall.

## Routes

| Route | Purpose |
|-------|---------|
| `GET /` | Public landing page |
| `GET /install` | Install wizard (OAuth redirect target) |
| `GET /assets/*` | Static assets (installer icon) |
| `POST /api/apply` | Runs the install (SSE progress) |
| `POST /api/uninstall` | Tears the install down |

## Uninstall

From the Done screen, or via **Manage an existing installation** on the wizard's
first screen (works across sessions). Uninstall removes the orchestration and
runs the `onUninstalled` hook.
