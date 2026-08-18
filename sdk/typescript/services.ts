import type { Client, Config } from './client';
import { createClient, createConfig } from './client';
import type { Application } from './types.gen';
import type {
  Context,
  InferResponse,
  MediaBlock,
  Message,
  Permission,
  ServiceDescription,
  ServiceInfo,
  Setting,
} from './shared-types';

// Re-export everything from shared-types for convenience
export type {
  AgentIdentity,
  AudioGenOptions,
  Context,
  ImageGenOptions,
  InferResponse,
  MediaBlock,
  Message,
  Permission,
  PermissionName,
  ServiceDescription,
  ServiceDescriptionPart,
  ServiceInfo,
  Setting,
} from './shared-types';
export { getBooleanSetting, getTextSetting, getSecretSetting } from './shared-types';
export { openStreamingChat } from './streaming';
export type {
  StreamingChat,
  StreamingChatConfig,
  StreamingChatEvents,
  StreamingChannel,
  ServerMessage,
} from './streaming';

// --- Client Factories ---

/** Create a client configured for an application's URL, optionally with a layer ID for context */
export function createApplicationClient(application: Application, layerId?: string): Client {
  return createClient(createConfig({
    baseUrl: application.application_url,
    headers: {
      ...(layerId ? { 'X-LayerId': layerId } : {}),
    },
  }));
}

/** Create a bare API client (no auth configured). Use with setupClientCredentials. */
export function createApiClient(): Client {
  return createClient(createConfig({
    baseUrl: (typeof process !== 'undefined' ? process.env.OAI_API_URL : undefined) ?? 'https://api.orchestration-ai.com',
  }));
}

/** Create a client configured for the engine URL with an access key */
export function createEngineClient(engineUrl: string | null, accessKey: string): Client;
/** Create a client configured for the production engine with an access key */
export function createEngineClient(accessKey: string): Client;
export function createEngineClient(engineUrlOrAccessKey: string | null, accessKey?: string): Client {
  const url = accessKey
    ? (engineUrlOrAccessKey ?? "https://oai-inference-engine-21142163942.africa-south1.run.app")
    : "https://oai-inference-engine-21142163942.africa-south1.run.app";
  const key = accessKey ?? (engineUrlOrAccessKey as string);
  return createClient(createConfig({
    baseUrl: url,
    headers: {
      Authorization: `Bearer ${key}`,
    },
  }));
}

// --- Application Service Endpoints ---

/** List all available services */
export async function listServices(client: Client): Promise<ServiceInfo[]> {
  const response = await client.get({
    url: '/services',
  });
  return response.data as ServiceInfo[];
}

/** Get permissions required by the application */
export async function getPermissions(client: Client): Promise<Permission[]> {
  const response = await client.get({
    url: '/permissions',
  });
  return response.data as Permission[];
}

/** Get default settings for a service */
export async function getDefaultSettings(
  serviceName: string,
  client: Client
): Promise<Setting[]> {
  const response = await client.get({
    url: `/services/${serviceName}/api/default-settings`,
  });
  return response.data as Setting[];
}

/** Get the service description (tools it exposes) */
export async function getServiceDescription(
  serviceName: string,
  client: Client
): Promise<ServiceDescription> {
  const response = await client.get({
    url: `/services/${serviceName}/api/description`,
  });
  return response.data as ServiceDescription;
}

/** Touch a service to notify it that its context may have changed */
export async function touchService(
  serviceName: string,
  client: Client
): Promise<void> {
  await client.post({
    url: `/services/${serviceName}/api/touch`,
  });
}

/** Call a service tool (arbitrary endpoint exposed by a service) */
export async function callServiceTool<TBody = unknown, TResponse = unknown>(
  serviceName: string,
  toolPath: string,
  client: Client,
  options?: {
    method?: "POST" | "GET" | "PATCH" | "DELETE" | "PUT";
    body?: TBody;
  }
): Promise<TResponse> {
  const method = (options?.method ?? "POST").toLowerCase() as "post" | "get" | "patch" | "delete" | "put";
  const response = await client[method]({
    url: `/services/${serviceName}/api/${toolPath}`,
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body,
  });
  return response.data as TResponse;
}

// --- Engine Agent Endpoints ---

/** Get the context for a layer */
export async function getContext(layerId: string, client: Client): Promise<Context> {
  const response = await client.get({
    url: `/agents/context/${layerId}`,
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as Context;
}

/** Send messages to an agent's layer and get the inference response */
export async function sendMessages(
  agentId: string,
  layerIndex: number,
  messages: Message[],
  layerId: string,
  client: Client,
  sessionId?: string
): Promise<InferResponse> {
  const response = await client.post({
    url: `/agents/${agentId}/layers/${layerIndex}/messages`,
    headers: {
      'X-LayerId': layerId,
      'Content-Type': 'application/json',
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
    body: messages,
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  const data = response.data;
  if (data && typeof data === 'object' && 'media' in data) {
    return data as { message: string; media: MediaBlock[] };
  } else if(typeof data === 'string') {
    return data;
  } else {
    throw new Error(`Unexpected response from engine: ${JSON.stringify(data)}`);
  }
}
