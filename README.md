# make-orchestration-ai

The public, open source components for [Orchestration AI](https://orchestration-ai.com) - The Operating System for AI-Powered Businesses.

This monorepo contains three independently usable components:

| Component | Description | Language |
|-----------|-------------|----------|
| [`sdk/`](#typescript-sdk) | TypeScript SDK for building OAI applications | TypeScript |
| [`shared-services/`](#shared-services) | Pre-built agent services deployable on Deno Deploy | TypeScript / Deno |
| [`repositories/terraform-provider-orchestration-ai/`](#terraform-provider) | Terraform provider for managing OAI resources | Go |

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

## Terraform Provider

A Terraform provider for managing Orchestration AI resources as infrastructure-as-code.

### Resources supported

| Resource | Description |
|----------|-------------|
| `oai_workspace` | Workspaces |
| `oai_orchestration` | Orchestrations |
| `oai_agent` | Agents |
| `oai_application` | Applications |
| `oai_endpoint` | Agent endpoints |
| `oai_link` | Agent links |
| `oai_setting` | Agent settings |
| `oai_llm_key` | LLM API keys |
| `oai_access` | Access control |
| `oai_ticker_config` | Ticker (cron) configuration |
| `oai_storage_file` | Storage files |
| `oai_storage_dir` | Storage directories |
| `oai_task` | Tasks |

### Data sources

- `oai_llm` - look up a single LLM
- `oai_llms` - list available LLMs
- `oai_service` - look up a service

### Prerequisites

- [Go](https://go.dev) 1.21+
- [Terraform](https://www.terraform.io) 1.5+

### Local development

```bash
cd repositories/terraform-provider-orchestration-ai

# Build
make build

# Install locally (~/.terraform.d/plugins/...)
make install

# Unit tests
make test

# Acceptance tests (requires live credentials)
ORCHESTRATION_AI_CLIENT_ID=<id> ORCHESTRATION_AI_CLIENT_SECRET=<secret> make testacc
```

### Usage example

```hcl
terraform {
  required_providers {
    orchestration_ai = {
      source  = "orchestration-ai/orchestration-ai"
      version = "~> 0.1"
    }
  }
}

provider "oai" {
  # Or set ORCHESTRATION_AI_CLIENT_ID / ORCHESTRATION_AI_CLIENT_SECRET env vars
  client_id     = var.oai_client_id
  client_secret = var.oai_client_secret
}

resource "oai_workspace" "main" {
  workspace_name = "my-workspace"
}

resource "oai_agent" "main" {
  workspace_id     = oai_workspace.main.id
  orchestration_id = oai_orchestration.main.id
  agent_name       = "my-agent"
  agent_description = "Handles the thing"
}
```

See [`repositories/terraform-provider-orchestration-ai/examples/main.tf`](repositories/terraform-provider-orchestration-ai/examples/main.tf) for a full example.

### CI

| Trigger | Action |
|---------|--------|
| Push to `qa` with changes under `repositories/terraform-provider-orchestration-ai/` | Build → acceptance tests → publish snapshot |

---

## Repository structure

```
make-orchestration-ai/
├── sdk/                                        # @orchestration-ai/sdk npm package
├── shared-services/                            # Deno Deploy application
│   ├── <service-name>/                         # One directory per service
│   │   ├── <service>.service.definition.ts     # Service definition (tools, settings, description)
│   │   ├── <service>.service.ts                # Tool implementations
│   │   └── public/                             # Optional static config UI
│   ├── app.ts                                  # Express app wiring
│   ├── main.ts                                 # Entrypoint
│   └── deno.json                               # Deno config + import map
└── repositories/
    └── terraform-provider-orchestration-ai/    # Go Terraform provider
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
