# @orchestration-ai/sdk

TypeScript SDK for [Orchestration AI](https://orchestration-ai.com) - The Operating System for AI-Powered Businesses.

Works in both **Node.js** and the **browser** using the same package.

## Installation

```bash
npm install @orchestration-ai/sdk
```

## Building Applications

The SDK provides everything you need to build Orchestration AI applications that expose services and tools to agents.

### Quick Start - Define an Application

```typescript
import { createApp, defineService } from '@orchestration-ai/sdk/app-builder';

createApp()
  .permissions([
    { permission_name: "role_agent_reader", justification: "Read agent context." },
    { permission_name: "role_agent_writer", justification: "Register endpoints." },
  ])
  .service(defineService({
    unique_name: "my-service",
    service_name: "My Service",
    service_description: "Does useful things for agents.",
    defaultSettings: [
      { setting_name: "API_KEY", setting_description: "External API key", setting_type: "Secret", text_value: "" },
    ],
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
        // body is the request payload
        // context contains the agent identity
        // engineClient is for engine calls (sendMessages, getContext)
        // apiClient is for API calls (settingFindByAgent, endpointCreate, etc.)
        return { result: `Processed: ${body.input}` };
      },
    },
  }))
  .listen(3001);
```

Visit `http://localhost:3001/explore` to see your services and test tools interactively.

### Application Structure

An application consists of:

- **Permissions** - Roles the app requires (granted on installation)
- **Services** - Each service exposes tools that agents can call

### Service Definition

Each service has:

| Field | Description |
|-------|-------------|
| `unique_name` | URL-safe identifier |
| `service_name` | Human-readable name |
| `service_description` | What the service does |
| `defaultSettings` | Settings created when the service is installed |
| `description` | Static array or dynamic function returning tool descriptions |
| `touch` | Called when the service's context may have changed |
| `tools` | Handler functions for each tool |

### Handler Signatures

All handlers receive the engine client and API client:

```typescript
// Tool handler
(body: any, context: Context, engineClient: Client, apiClient: Client) => unknown | Promise<unknown>

// Touch handler
(context: Context, engineClient: Client, apiClient: Client) => void | Promise<void>

// Description handler (dynamic)
(context: Context, engineClient: Client, apiClient: Client) => ServiceDescription | Promise<ServiceDescription>
```

### Two Clients

The app-builder provides two pre-configured clients to every handler:

| Client | Purpose | Auth |
|--------|---------|------|
| `engineClient` | Internal engine calls (`sendMessages`, `getContext`) | Bearer access key |
| `apiClient` | Public API calls (`settingFindByAgent`, `endpointCreate`, `linkCreate`) | OAuth client_credentials |

### Static vs Dynamic Descriptions

**Static** - TypeScript enforces that `tools` keys match the `path` values in `description`:

```typescript
import { defineService } from '@orchestration-ai/sdk/app-builder';

export const myService = defineService({
  unique_name: "calculator",
  service_name: "Calculator",
  service_description: "Math operations.",
  description: [
    { path: "add", method: "POST", description: "Adds two numbers.", parameters: { a: { type: "number", optional: false, description: "First number" }, b: { type: "number", optional: false, description: "Second number" } } },
  ],
  tools: {
    add: (body) => ({ result: body.a + body.b }),
    // TypeScript error if you add a tool not in description, or miss one
  },
});
```

**Dynamic** - When the description depends on context/settings:

```typescript
import { defineServiceWithDynamicDescription } from '@orchestration-ai/sdk/app-builder';

export const myService = defineServiceWithDynamicDescription({
  unique_name: "conditional",
  service_name: "Conditional Service",
  service_description: "Tools depend on settings.",
  description: async (context, engineClient, apiClient) => {
    const { data } = await settingFindByAgent({ client: apiClient, path: { ... } });
    // Return different tools based on settings
    return [...];
  },
  tools: {
    tool_a: (body, context) => { ... },
    tool_b: (body, context) => { ... },
  },
});
```

### Touch Handler

Called by the engine when a service's context may have changed. Use it to register endpoints or links:

```typescript
touch: async (context, engineClient, apiClient) => {
  await endpointCreate({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
    body: {
      description: "Webhook for receiving events.",
      endpoint: `https://my-app.com/webhook/${context.identity.layerId}`,
    },
  });
}
```

### Settings

Three types of settings:

| Type | Use Case |
|------|----------|
| `Text` | General configuration values |
| `Boolean` | Feature flags, toggles |
| `Secret` | API keys, passwords (treated securely by the engine) |

Utility functions for reading settings:

```typescript
import { getBooleanSetting, getTextSetting, getSecretSetting } from '@orchestration-ai/sdk/services';

const enabled = getBooleanSetting(settings, "FEATURE_ENABLED");
const host = getTextSetting(settings, "SMTP_HOST");
const apiKey = getSecretSetting(settings, "API_KEY");
```

### Sending Messages to Agents

Use the engine client to send messages:

```typescript
import { sendMessages } from '@orchestration-ai/sdk/services';

const response = await sendMessages(
  agentId,
  layerIndex,
  [{ message: "Hello from my service" }],
  context.identity.layerId,
  engineClient
);
```

Pass an optional `sessionId` to maintain conversation history across multiple calls. Without it, each call is stateless:

```typescript
const sessionId = crypto.randomUUID();

const response = await sendMessages(
  agentId,
  layerIndex,
  [{ message: "Hello" }],
  context.identity.layerId,
  engineClient,
  sessionId
);
```

### Streaming Chat

For realtime, streaming conversations with agents, use `openStreamingChat`. It opens a WebSocket connection and streams the agent's response chunk by chunk. Works in both Node.js and the browser - no extra dependencies required.

```typescript
import { openStreamingChat } from '@orchestration-ai/sdk/streaming';

const chat = openStreamingChat('agent-id', 0, {
  onChunk: (chunk) => process.stdout.write(chunk),
  onResponse: (fullText) => console.log('\n[Done]'),
  onCancelled: () => console.log('[Cancelled]'),
  onError: (err) => console.error('[Error]', err),
  onOpen: () => console.log('[Connected]'),
  onClose: () => console.log('[Disconnected]'),
}, {
  accessKey: 'your-access-key', // optional - falls back to OAI_ACCESS_KEY env
  sessionId: 'optional-session-id', // optional - enables conversation persistence
});

// Send a message (agent streams its reply via onChunk)
chat.send('What are my sales numbers this month?');

// Cancel the current stream mid-response
chat.cancel();

// Close the connection (clears conversation memory)
chat.close();
```

**Browser example:**

```typescript
import { openStreamingChat } from '@orchestration-ai/sdk/streaming';

const output = document.getElementById('output');

const chat = openStreamingChat(agentId, 0, {
  onChunk: (chunk) => { output.textContent += chunk; },
  onResponse: () => { /* response complete */ },
  onError: (err) => { output.textContent = `Error: ${err}`; },
}, { accessKey: 'your-access-key' });

document.getElementById('send-btn').onclick = () => {
  output.textContent = '';
  chat.send(document.getElementById('input').value);
};
```

**Key details:**

- The connection maintains conversation memory - each message builds on prior context within the session.
- Sending a new message while a response is streaming implicitly cancels the previous stream.
- Calling `chat.close()` ends the session. Open a new connection for a fresh conversation.
- Unknown server channels are silently ignored for forward compatibility.

### Getting Agent Context

```typescript
import { getContext } from '@orchestration-ai/sdk/services';

const context = await getContext(layerId, engineClient);
// context.identity.agentId, .layerId, .orchestrationId, .workspaceId, etc.
```

### Custom Endpoints

Access the underlying Express app and HTTP server for custom routes or WebSockets:

```typescript
const app = createApp().service(myService);

// Custom route
app.expressApp.post("/custom/:id", (req, res) => { ... });

// WebSocket
import { Server } from "socket.io";
const io = new Server(app.httpServer, { path: "/ws" });
io.on("connection", (socket) => { ... });

app.listen(3001);
```

### Explore Page

The `/explore` endpoint renders an interactive page showing all services, tools, and permissions. You can test tools directly from the browser.

Disable in production:

```typescript
createApp({ explore: false }).service(...).listen(3001);
```

## Client Factories

### createEngineClient

For calling engine internal endpoints:

```typescript
import { createEngineClient } from '@orchestration-ai/sdk/services';

// Production (default URL)
const client = createEngineClient(accessKey);

// Custom URL
const client = createEngineClient("https://my-engine.com", accessKey);

// Nullable URL (falls back to production)
const client = createEngineClient(process.env.ENGINE_URL ?? null, accessKey);
```

### createApplicationClient

For calling another OAI application's services:

```typescript
import { createApplicationClient, listServices, callServiceTool } from '@orchestration-ai/sdk/services';

const client = createApplicationClient(application, layerId);
const services = await listServices(client);
const result = await callServiceTool("service-name", "tool-path", client, { body: { key: "value" } });
```

### createApiClient

For making authenticated API calls with OAuth:

```typescript
import { createApiClient } from '@orchestration-ai/sdk/services';
import { setupClientCredentials } from '@orchestration-ai/sdk/oauth-utils';

const apiClient = createApiClient();
setupClientCredentials(apiClient, {
  client_id: accessKey,
  client_secret: `${accessKey}:${workspaceOwnerId}`,
});

// Now use with sdk.gen functions
await settingFindByAgent({ client: apiClient, path: { ... } });
```

## Authentication

### Node.js (Server-Side)

For server-to-server authentication, use the **client_credentials** OAuth flow:

```typescript
import { client } from '@orchestration-ai/sdk/client.gen';
import { setupClientCredentials } from '@orchestration-ai/sdk/oauth-utils';

setupClientCredentials(client, {
  client_id: 'your-client-id',
  client_secret: 'your-client-secret',
  scope: 'role_admin',
});
```

The SDK automatically obtains and refreshes tokens.

### Browser (Client-Side)

```typescript
import { client } from '@orchestration-ai/sdk/client.gen';
import { setupBrowserAuth, initiateLogin, parseLoginRedirect, saveLogin, logout } from '@orchestration-ai/sdk/oauth-utils';

setupBrowserAuth(client, {
  onRefreshToken: async () => {
    const response = await fetch('/api/auth/refresh');
    return response.ok ? response.json() : null;
  },
});

// Initiate login
initiateLogin(client.getConfig().baseURL, {
  client_id: 'your-client-id',
  redirect_uri: 'https://your-app.com/callback',
});

// Handle callback
const result = parseLoginRedirect();
if (result.granted) {
  const tokens = await fetch('/api/auth/exchange', {
    method: 'POST',
    body: JSON.stringify({ code: result.code, redirect_uri: '...' }),
  }).then(r => r.json());
  saveLogin(tokens);
}
```

## API Usage Examples

```typescript
import { workspaceFind, orchestrationCreate, agentCreate } from '@orchestration-ai/sdk/sdk.gen';

// List workspaces
const { data } = await workspaceFind();

// Create an orchestration
const { data: orch } = await orchestrationCreate({
  path: { workspaceId: 'ws-id' },
  body: { orchestration_name: 'My Orchestration', orchestration_description: '...' },
});

// Create an agent
const { data: agent } = await agentCreate({
  path: { workspaceId: 'ws-id', orchestrationId: 'orch-id' },
  body: { agent_name: 'Support Agent', agent_description: '...' },
});
```

## Roles & Permissions

Applications declare permissions using Casbin role names:

| Role | Description |
|------|-------------|
| `role_admin` | Full access to everything |
| `role_workspace_admin` | Full workspace + orchestration + agent access |
| `role_agent_reader` | Read agent data |
| `role_agent_writer` | Read + create + update agents |
| `role_agent_admin` | Full agent CRUD |
| `role_service_reader` | Read services |

See the full hierarchy in the [Roles & Permissions](#roles-hierarchy) section below.

### Roles Hierarchy

| Role | Inherits |
|------|----------|
| `role_admin` | All admin roles + `role_llm_reader`, `role_llm_lister`, `role_service_reader`, `role_service_lister`, `role_day_pass_transaction_lister` |
| `role_workspace_admin` | `role_workspace_writer`, `role_workspace_lister`, `role_workspace_deleter`, `role_orchestration_admin` |
| `role_orchestration_admin` | `role_orchestration_writer`, `role_orchestration_lister`, `role_orchestration_deleter`, `role_agent_admin` |
| `role_agent_admin` | `role_agent_writer`, `role_agent_lister`, `role_agent_deleter` |
| `role_application_admin` | `role_application_writer`, `role_application_lister`, `role_application_deleter` |
| `role_access_admin` | `role_access_writer`, `role_access_lister`, `role_access_deleter` |

Writer roles inherit inserter + reader + updater. Each resource has `_reader`, `_lister`, `_inserter`, `_updater`, `_deleter` granular permissions.

## License

MIT
