# make-orchestration-ai

The public, open source components for [Orchestration AI](https://orchestration-ai.com) - The Operating System for AI-Powered Businesses.

This monorepo contains three independently usable components:

| Component | Description | Language |
|-----------|-------------|----------|
| [`sdk/`](#typescript-sdk) | TypeScript SDK for building OAI applications | TypeScript |
| [`shared-services/`](#shared-services) | Pre-built agent services deployable on Deno Deploy | TypeScript / Deno |
| [`create-installer/`](#orchestration-installers) | Scaffolder for orchestration installers | TypeScript / Node |
| [terraform-provider-orchestration-ai](https://github.com/Orchestration-AI/terraform-provider-orchestration-ai) | Terraform provider for managing OAI resources | Go |

---

## TypeScript SDK

The `@orchestration-ai/sdk` package lets you build applications that expose services and tools to Orchestration AI agents. Works in both Node.js and the browser.

### Installation

```bash
npm install @orchestration-ai/sdk
```

### Quick start

```typescript
import { createApp, defineService } from '@orchestration-ai/sdk/app-builder';

createApp()
  .permissions([
    { permission_name: "role_agent_reader", justification: "Read agent context." },
  ])
  .service(defineService({
    unique_name: "my-service",
    service_name: "My Service",
    service_description: "Does useful things for agents.",
    description: [
      {
        path: "do_thing",
        method: "POST",
        description: "Performs an action.",
        parameters: {
          input: { type: "string", optional: false, description: "The input value." },
        },
      },
    ],
    tools: {
      do_thing: async (body, context, engineClient, apiClient) => {
        return { result: `Processed: ${body.input}` };
      },
    },
  }))
  .listen(3001);
```

Visit `http://localhost:3001/explore` to interactively browse and test your services.

### Building the SDK

```bash
cd sdk
npm install
npm run build
```

### Publishing

```bash
npm publish
```

The `prepublishOnly` script runs the full build automatically.

For full SDK documentation see [`sdk/README.md`](sdk/README.md).

---

## Shared Services

A Deno application that bundles a collection of ready-made services for Orchestration AI agents. Deployed on [Deno Deploy](https://deno.com/deploy).

### Services included

| Service | Description |
|---------|-------------|
| `messaging` | Inter-agent messaging |
| `voice` | Streaming voice chat via WebSocket |
| `telnyx-voice` | Telnyx PSTN voice calls with webhook handling |
| `mail` | SMTP send + IMAP receive with attachment support |
| `sql-server` | Microsoft SQL Server query execution |
| `webhook` | Inbound webhook event processing (sync or async) |
| `mathjs` | Math expression evaluation via math.js |
| `oai-files` | OpenAI Files API integration |
| `multimedia` | PDF and image processing (MuPDF, pngjs, markitdown) |
| `internet` | Web browsing and content fetching |
| `time` | Date/time utilities |
| `contacts` | Agent contact management with a config UI |
| `reminders` | Agent reminder scheduling via ticker tasks |
| `notion` | Notion workspace integration via the official Notion SDK, with OAI file bridging |

### Prerequisites

- [Deno](https://deno.com) v2+

### Local development

```bash
cd shared-services
cp .env.example .env   # fill in required values (see Environment Variables below)
deno task dev
```

The app starts on `http://localhost:3001` by default. Set `PORT` to override.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OAI_ACCESS_KEY` | Yes | Your Orchestration AI access key |
| `ENGINE_URL` | No | Override the engine base URL (defaults to production) |
| `PORT` | No | HTTP port (default: `3001`) |

Individual services may require additional settings configured through the Orchestration AI platform (e.g. SMTP credentials for the mail service, Telnyx API key for voice). These are stored as agent-scoped settings, not environment variables.

### Deployment

The app is deployed to [Deno Deploy](https://deno.com/deploy) automatically via CI.

| Branch | Environment | URL |
|--------|-------------|-----|
| `qa` | Staging | https://make-oai--qa.orchestration-ai.deno.net |
| `main` | Production | https://make-oai.orchestration-ai.deno.net |

Pushes to `qa` trigger a staging deploy. Merges to `main` trigger a production deploy.

### Adding a new service

1. Create a new directory under `shared-services/` (e.g. `my-service/`)
2. Define the service in `my-service/my-service.service.definition.ts` using `defineService` or `defineServiceWithDynamicDescription` from the SDK
3. Register it in [`shared-services/app.ts`](shared-services/app.ts) with `.service(myService)`

---

## Orchestration Installers

An **installer** lets a developer package a whole orchestration (agents, layers,
settings, files, and third-party connections) behind a shareable install link.
A visitor opens the link, sees a landing page describing what will be installed,
authorizes with `role_admin`, picks (or creates) a workspace, completes any
custom setup steps, and applies — all without writing Terraform.

Installers are built with the SDK's `@orchestration-ai/sdk/installer` module and
scaffolded with `@orchestration-ai/create-installer`.

### Declaring an installer

```typescript
import { defineOrchestration } from "@orchestration-ai/sdk/installer";

export const myInstaller = defineOrchestration({
  installer_name: "Sales Copilot",
  installer_version: "1.0.0",
  tagline: "An AI sales team that triages leads and drafts follow-ups.",
  required_scope: "role_admin",
  orchestration: {
    orchestration_name: "sales-copilot",
    orchestration_description: "Triages inbound leads and drafts follow-ups.",
    files: [{ path: "playbook.md", content: "# Playbook" }],
    agents: [{
      agent_name: "triage",
      agent_description: "Classifies inbound leads.",
      layers: [{ layer_name: "classify", context_md: "Classify leads.", services: ["messaging"] }],
      settings: [{ setting_name: "crm_region", setting_description: "Region", setting_type: "Text", default: "eu" }],
    }],
  },
});
```

### Serving it

```typescript
import { createInstaller } from "@orchestration-ai/sdk/installer";
import { myInstaller } from "./my.installer";

createInstaller(myInstaller, {
  oauthClientId: process.env.INSTALLER_OAUTH_CLIENT_ID,
  oauthClientSecret: process.env.INSTALLER_OAUTH_CLIENT_SECRET,
  oauthRedirectUri: process.env.INSTALLER_OAUTH_REDIRECT_URI,
}).listen(3002);
```

| Route | Purpose |
|-------|---------|
| `GET /` | Public landing page (the advertised install link) |
| `GET /install` | Install wizard + OAuth redirect target |
| `POST /api/apply` | Runs the install, streaming progress over SSE |
| `POST /api/uninstall` | Removes the orchestration and runs custom-step teardown |

Each installer uses its **own** OAuth client, so the consent screen shows the
installer's application name. The client secret stays server-side.

### Custom steps

Installers can include custom HTML5 steps that connect third-party services
(e.g. a CRM via OAuth). A step emits settings and an `undo_state`; the framework
merges the settings into the orchestration and stores the `undo_state` so the
step's `uninstall` hook can revoke the third-party connection on teardown.

### Lifecycle hooks

An installer can define `onInstalled` and `onUninstalled` hooks that run
server-side once per install/uninstall — e.g. send a greeting email to the
client after installation. They receive the API client, workspace/orchestration
ids, the install record, and (for `onInstalled`) the applied settings. Hook
errors are reported but never roll back the operation.

```typescript
defineOrchestration({
  // ...
  onInstalled: async (ctx) => {
    // ctx.workspaceId, ctx.orchestrationId, ctx.record, ctx.settings
    await sendGreetingEmail(ctx.settings);
  },
  onUninstalled: async (ctx) => {
    await notifyRemoval(ctx.orchestrationId);
  },
});
```

### LLM selection & fallback

Layers reference an LLM **by name** (not id), resolved against the installing
user's available LLMs at apply time:

```typescript
layers: [{
  layer_name: "main",
  llm_name: "claude-sonnet-5",            // preferred
  fallback_llm_name: "gemini-2.5-flash:oai", // if the user lacks the preferred one
}]
```

Not every user has every model — Anthropic/OpenAI models only appear after the
user loads their keys. If the preferred `llm_name` is unavailable, the installer
falls back to `fallback_llm_name`, then to the platform-guaranteed
`gemini-2.5-flash:oai`. Before installing, the wizard shows an **LLMs** step
(only when a fallback would apply) listing each layer's requested vs. effective
model, a link to load keys at
[console.orchestration-ai.com/llm-keys](https://console.orchestration-ai.com/llm-keys),
and a refresh / auto-refresh (new models can take up to ~1 minute to appear).

### Scaffolding

```bash
# New project
npx @orchestration-ai/create-installer "Sales Copilot"

# Into an existing project (e.g. shared-services), with wiring + a custom-step example
npx @orchestration-ai/create-installer --into shared-services --name "Sales Copilot" --wire --custom-step
```

See [`examples/sales-copilot-installer/`](examples/sales-copilot-installer) for a
complete, standalone worked example.

---

## Repository structure

```
make-orchestration-ai/
├── sdk/                                        # @orchestration-ai/sdk npm package
└── shared-services/                            # Deno Deploy application
    ├── <service-name>/                         # One directory per service
    │   ├── <service>.service.definition.ts     # Service definition (tools, settings, description)
    │   ├── <service>.service.ts                # Tool implementations
    │   └── public/                             # Optional static config UI
    ├── app.ts                                  # Express app wiring
    ├── main.ts                                 # Entrypoint
    └── deno.json                               # Deno config + import map
```

---

## Contributing

1. Fork the repo and create a branch off `qa`
2. Make your changes
3. Open a pull request targeting `qa`
4. Once reviewed and merged, changes deploy to staging automatically
5. Promotion to `main` deploys to production

Please make sure there are no secrets, credentials, or PII in your commits.

---

## License

MIT
