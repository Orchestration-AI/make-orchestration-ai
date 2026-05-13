# @orchestration-ai/sdk

TypeScript SDK for [Orchestration AI](https://orchestration-ai.com) — The Operating System for AI-Powered Businesses.

Works in both **Node.js** and the **browser** using the same package.

## Installation

```bash
npm install @orchestration-ai/sdk
```

## Quick Start

The SDK exports a pre-configured `client` with the correct base URL. Just import and use:

```typescript
import { client } from '@orchestration-ai/sdk/client.gen';
import { workspaceFind } from '@orchestration-ai/sdk/sdk.gen';

const response = await workspaceFind();
console.log(response.data);
```

## Authentication

### Node.js (Server-Side)

For server-to-server authentication, use the **client_credentials** OAuth flow. The SDK manages token acquisition and refresh automatically:

```typescript
import { client } from '@orchestration-ai/sdk/client.gen';
import { setupClientCredentials } from '@orchestration-ai/sdk/oauth-utils';
import { workspaceFind } from '@orchestration-ai/sdk/sdk.gen';

// Setup once — tokens are fetched and refreshed automatically
setupClientCredentials(client, {
  client_id: 'your-client-id',
  client_secret: 'your-client-secret',
  scope: 'role_admin', // any supported role as scope
});

// All requests are now authenticated
const workspaces = await workspaceFind();
```

The SDK will:
- Automatically obtain an access token via `client_credentials` on the first request
- Re-fetch the token when it expires (with a 30s buffer)
- Retry once on 401 responses with a fresh token
- Deduplicate concurrent token requests

The `scope` parameter accepts any supported role (e.g. `role_admin`, `role_workspace_writer`, `role_agent_reader`). See [Roles & Permissions](#roles--permissions) for the full list.

### Browser (Client-Side)

Browser apps should never expose a `client_secret`. The SDK provides utilities to manage the OAuth redirect flow and token storage. Token acquisition and refresh should be handled by your backend.

```typescript
import { client } from '@orchestration-ai/sdk/client.gen';
import {
  setupBrowserAuth,
  initiateLogin,
  parseLoginRedirect,
  saveLogin,
  getCurrentLogin,
  isLoginExpired,
  logout,
} from '@orchestration-ai/sdk/oauth-utils';

// Attach stored tokens to all requests automatically
// Optionally provide a refresh callback for automatic token renewal
setupBrowserAuth(client, {
  onRefreshToken: async () => {
    // Call your backend to refresh the token
    const response = await fetch('/api/auth/refresh');
    if (!response.ok) return null;
    return response.json(); // must return OAuthTokens shape
  },
});
```

#### OAuth Login Flow

**Step 1: Initiate login (redirects the browser)**

```typescript
import { client } from '@orchestration-ai/sdk/client.gen';
import { initiateLogin } from '@orchestration-ai/sdk/oauth-utils';

function handleLoginClick() {
  initiateLogin(client.getConfig().baseURL, {
    client_id: 'your-client-id',
    redirect_uri: 'https://your-app.com/callback',
    scope: 'role_admin', // any supported role as scope
  }, 'optional-state-value');
}
```

This redirects the user to the Orchestration AI login page.

**Step 2: Handle the redirect callback**

On your callback page (e.g. `/callback`), parse the redirect result and exchange the code via your backend:

```typescript
import { parseLoginRedirect, saveLogin } from '@orchestration-ai/sdk/oauth-utils';

const result = parseLoginRedirect();

if (result.granted) {
  // Send the code to your backend to exchange for tokens securely
  // IMPORTANT: pass the same redirect_uri used in initiateLogin
  const tokens = await fetch('/api/auth/exchange', {
    method: 'POST',
    body: JSON.stringify({
      code: result.code,
      redirect_uri: 'https://your-app.com/callback',
    }),
  }).then(r => r.json());

  // Save the tokens — setupBrowserAuth will attach them to future requests
  saveLogin(tokens);
} else {
  console.error('Login denied:', result.error, result.error_description);
}
```

#### Token Refresh

If you provided `onRefreshToken` to `setupBrowserAuth`, token refresh is handled automatically — both proactively when the token is about to expire and reactively on 401 responses.

If you prefer to handle refresh manually:

```typescript
import { isLoginExpired, saveLogin, logout } from '@orchestration-ai/sdk/oauth-utils';

if (isLoginExpired()) {
  const response = await fetch('/api/auth/refresh');
  if (response.ok) {
    saveLogin(await response.json());
  } else {
    logout();
  }
}
```

#### Logout

```typescript
import { logout } from '@orchestration-ai/sdk/oauth-utils';

logout(); // Clears stored tokens from localStorage
```

## API Usage Examples

### Workspaces

```typescript
import { workspaceFind, workspaceCreate, workspaceFindById } from '@orchestration-ai/sdk/sdk.gen';

// List workspaces
const { data } = await workspaceFind({ query: { limit: 10, offset: 0 } });

// Create a workspace
const { data: workspace } = await workspaceCreate({
  body: { workspace_name: 'My Workspace' },
});

// Get a workspace by ID
const { data: ws } = await workspaceFindById({ path: { id: 'workspace-id' } });
```

### Orchestrations

```typescript
import {
  orchestrationFindByWorkspace,
  orchestrationCreate,
} from '@orchestration-ai/sdk/sdk.gen';

// List orchestrations in a workspace
const { data } = await orchestrationFindByWorkspace({
  path: { workspaceId: 'workspace-id' },
});

// Create an orchestration
const { data: orch } = await orchestrationCreate({
  path: { workspaceId: 'workspace-id' },
  body: {
    orchestration_name: 'My Orchestration',
    orchestration_description: 'Handles customer support',
  },
});
```

### Agents

```typescript
import { agentFindByOrchestration, agentCreate } from '@orchestration-ai/sdk/sdk.gen';

// List agents
const { data } = await agentFindByOrchestration({
  path: { workspaceId: 'ws-id', orchestrationId: 'orch-id' },
});

// Create an agent
const { data: agent } = await agentCreate({
  path: { workspaceId: 'ws-id', orchestrationId: 'orch-id' },
  body: {
    agent_name: 'Support Agent',
    agent_description: 'Handles tier 1 support tickets',
  },
});
```

### Error Handling

```typescript
import { workspaceFind } from '@orchestration-ai/sdk/sdk.gen';

const response = await workspaceFind();

if (response.error) {
  console.error('Request failed:', response.error);
} else {
  console.log('Workspaces:', response.data);
}
```

### Using throwOnError

```typescript
import { workspaceFind } from '@orchestration-ai/sdk/sdk.gen';

try {
  const response = await workspaceFind({ throwOnError: true });
  console.log('Workspaces:', response.data);
} catch (error) {
  console.error('Request failed:', error);
}
```

## Roles & Permissions

Access control uses a hierarchical role system. Higher-level roles inherit all permissions from their children.

### Top-Level Roles

| Role | Inherits |
|------|----------|
| `role_admin` | `role_workspace_admin`, `role_application_admin`, `role_access_admin`, `role_llm_keys_admin`, `role_llm_reader`, `role_llm_lister`, `role_service_reader`, `role_service_lister`, `role_day_pass_transaction_lister` |

### Admin Roles

| Role | Inherits |
|------|----------|
| `role_workspace_admin` | `role_workspace_writer`, `role_workspace_lister`, `role_workspace_deleter`, `role_orchestration_admin` |
| `role_orchestration_admin` | `role_orchestration_writer`, `role_orchestration_lister`, `role_orchestration_deleter`, `role_agent_admin` |
| `role_agent_admin` | `role_agent_writer`, `role_agent_lister`, `role_agent_deleter` |
| `role_application_admin` | `role_application_writer`, `role_application_lister`, `role_application_deleter` |
| `role_access_admin` | `role_access_writer`, `role_access_lister`, `role_access_deleter` |
| `role_llm_keys_admin` | `role_llm_keys_writer`, `role_llm_keys_lister` |

### Writer Roles

| Role | Inherits |
|------|----------|
| `role_workspace_writer` | `role_workspace_inserter`, `role_workspace_reader`, `role_workspace_updater` |
| `role_orchestration_writer` | `role_orchestration_inserter`, `role_orchestration_reader`, `role_orchestration_updater` |
| `role_agent_writer` | `role_agent_inserter`, `role_agent_reader`, `role_agent_updater` |
| `role_application_writer` | `role_application_inserter`, `role_application_reader`, `role_application_updater` |
| `role_access_writer` | `role_access_inserter`, `role_access_reader` |
| `role_llm_keys_writer` | `role_llm_keys_inserter`, `role_llm_keys_reader`, `role_llm_keys_updater` |

### Granular Permissions

Each resource has fine-grained permissions:

- `*_reader` — Read a single resource by ID
- `*_lister` — List/query resources
- `*_inserter` — Create new resources
- `*_updater` — Update existing resources
- `*_deleter` — Delete resources

### Example: Granting Access

```typescript
import { accessCreate } from '@orchestration-ai/sdk/sdk.gen';

// Grant a user full admin access to a workspace
await accessCreate({
  body: {
    resource_id: 'workspace-id',
    principal_id: 'user-uid',
    principal_name: 'Jane Doe',
    principal_email: 'jane@example.com',
    role: 'role_admin',
  },
});

// Grant read-only access to orchestrations
await accessCreate({
  body: {
    resource_id: 'workspace-id',
    principal_id: 'user-uid',
    principal_name: 'Viewer',
    principal_email: 'viewer@example.com',
    role: 'role_orchestration_reader',
  },
});
```

## License

MIT
