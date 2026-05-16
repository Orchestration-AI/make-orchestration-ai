import type { Client } from './client';
import { client as defaultClient } from './client.gen';

// --- Types ---

export type AgentIdentity = {
  agentId: string;
  agentName: string;
  layerId: string;
  layerIndex: number;
  numberOfLayers: number;
  orchestrationId: string;
};

export type Setting =
  | { setting_name: string; setting_description: string; setting_type: "Text"; text_value: string }
  | { setting_name: string; setting_description: string; setting_type: "Boolean"; boolean_value: boolean }
  | { setting_name: string; setting_description: string; setting_type: "Secret"; text_value: string };

export type ServiceInfo = {
  unique_name: string;
  service_name: string;
  service_description: string;
};

type ServiceDescriptionParameters = Record<
  string,
  {
    optional: boolean;
    description: string;
  } & (
    | { type: "string" | "boolean" | "number" }
    | { type: "enum"; options: string[] }
    | { type: "object"; properties: ServiceDescriptionParameters }
  )
>;

export type ServiceDescriptionPart = {
  path: string;
  description: string;
  method: "POST" | "GET" | "PATCH" | "DELETE" | "PUT";
  parameters: ServiceDescriptionParameters;
};

export type ServiceDescription = ServiceDescriptionPart[];

export type Permission = {
  permission_name: string;
  justification: string;
};

export type Context = {
  identity: AgentIdentity;
};

export type Message = {
  message: string;
};

// --- Service Client ---

export type ServiceClientOptions = {
  /** The layerId providing context for authentication */
  layerId: string;
  /** Optional custom client instance */
  client?: Client;
};

function getClient(options: ServiceClientOptions): Client {
  return options.client ?? defaultClient;
}

function contextHeaders(layerId: string): Record<string, string> {
  return { 'X-LayerId': layerId };
}

/** List all available services */
export async function listServices(options: ServiceClientOptions): Promise<ServiceInfo[]> {
  const c = getClient(options);
  const response = await c.get({
    url: '/services',
    headers: contextHeaders(options.layerId),
    responseType: 'json',
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as ServiceInfo[];
}

/** Get permissions required by the application */
export async function getPermissions(options: ServiceClientOptions): Promise<Permission[]> {
  const c = getClient(options);
  const response = await c.get({
    url: '/permissions',
    headers: contextHeaders(options.layerId),
    responseType: 'json',
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as Permission[];
}

/** Get default settings for a service */
export async function getDefaultSettings(
  serviceName: string,
  options: ServiceClientOptions
): Promise<Setting[]> {
  const c = getClient(options);
  const response = await c.get({
    url: `/services/${serviceName}/api/default-settings`,
    headers: contextHeaders(options.layerId),
    responseType: 'json',
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as Setting[];
}

/** Get the service description (tools it exposes) */
export async function getServiceDescription(
  serviceName: string,
  options: ServiceClientOptions
): Promise<ServiceDescription> {
  const c = getClient(options);
  const response = await c.get({
    url: `/services/${serviceName}/api/description`,
    headers: contextHeaders(options.layerId),
    responseType: 'json',
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as ServiceDescription;
}

/** Touch a service to notify it that its context may have changed */
export async function touchService(
  serviceName: string,
  options: ServiceClientOptions
): Promise<void> {
  const c = getClient(options);
  await c.post({
    url: `/services/${serviceName}/api/touch`,
    headers: contextHeaders(options.layerId),
    security: [{ scheme: 'bearer', type: 'http' }],
  });
}

/** Call a service tool (arbitrary endpoint exposed by a service) */
export async function callServiceTool<TBody = unknown, TResponse = unknown>(
  serviceName: string,
  toolPath: string,
  options: ServiceClientOptions & {
    method?: "POST" | "GET" | "PATCH" | "DELETE" | "PUT";
    body?: TBody;
  }
): Promise<TResponse> {
  const c = getClient(options);
  const method = (options.method ?? "POST").toLowerCase() as "post" | "get" | "patch" | "delete" | "put";
  const response = await c[method]({
    url: `/services/${serviceName}/api/${toolPath}`,
    headers: {
      ...contextHeaders(options.layerId),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body,
    responseType: 'json',
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as TResponse;
}

// --- Engine Agent Endpoints ---

/** Get the context for a layer (identity + settings) */
export async function getContext(options: ServiceClientOptions): Promise<Context> {
  const c = getClient(options);
  const response = await c.get({
    url: `/agents/context/${options.layerId}`,
    responseType: 'json',
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as Context;
}

/** Send messages to an agent's layer and get the inference response */
export async function sendMessages(
  agentId: string,
  layerIndex: number,
  messages: Message[],
  options: ServiceClientOptions
): Promise<string> {
  const c = getClient(options);
  const response = await c.post({
    url: `/agents/${agentId}/layers/${layerIndex}/messages`,
    headers: {
      ...contextHeaders(options.layerId),
      'Content-Type': 'application/json',
    },
    body: messages,
    responseType: 'text',
    security: [{ scheme: 'bearer', type: 'http' }],
  });
  return response.data as string;
}
