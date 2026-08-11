import type { Client } from './client';
import type { Layer } from './types.gen';
import type { Context, InferResponse, ServiceDescriptionParameters } from './shared-types';
import { layerFindByAgent } from './sdk.gen';
import { sendMessages } from './services';

// --- VM hook types (as defined by the engine) ---

export type ToolPayload = {
  tool: string;
  args: Record<string, unknown>;
};

export type VmToolDefinition = {
  name: string;
  path: string;
  description: string;
  method: 'POST';
  parameters: ServiceDescriptionParameters;
};

export type VmHooks = {
  getTools: (context: Context) => VmToolDefinition[] | Promise<VmToolDefinition[]>;
  onPreLayerCall: (message: string, context: Context) => string | Promise<string>;
  onPostLayerCall: (text: string, context: Context) => string | Promise<string>;
  onPreTool: (payload: ToolPayload, context: Context) => ToolPayload | Promise<ToolPayload>;
  onTool: (payload: ToolPayload, context: Context) => unknown | Promise<unknown>;
};

// --- Pipeline value type ---
// Steps pass values forward as-is; each step is responsible for handling the type it receives.
export type PipelineValue = string | object;

// --- Pipeline node types ---

export type PreLayerNode = (message: PipelineValue, context: Context) => PipelineValue | Promise<PipelineValue>;
export type PostLayerNode = (text: PipelineValue, context: Context) => PipelineValue | Promise<PipelineValue>;
export type PreToolNode = (payload: ToolPayload, context: Context) => ToolPayload | Promise<ToolPayload>;

export type DelegateNode = {
  _type: 'delegate';
  targetDef: LayerDefinition;
  passSessionId: boolean;
};

export type PreLayerPipelineStep = PreLayerNode | DelegateNode;
export type PostLayerPipelineStep = PostLayerNode | DelegateNode;

// --- Tool definition ---

export type ToolHandler<TArgs = Record<string, unknown>> = (
  args: TArgs,
  context: Context
) => unknown | Promise<unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  schema: ServiceDescriptionParameters;
  handler: ToolHandler;
};

export function defineTool<TArgs = Record<string, unknown>>(
  name: string,
  description: string,
  schema: ServiceDescriptionParameters,
  handler: ToolHandler<TArgs>
): ToolDefinition {
  return { name, description, schema, handler: handler as ToolHandler };
}

// Creates a delegate pipeline step pointing at a LayerDefinition.
// Because it holds a direct reference, the compiler will catch undefined layers at author time.
export function delegateTo(
  layer: LayerDefinition,
  options?: { passSessionId?: boolean }
): DelegateNode {
  return { _type: 'delegate', targetDef: layer, passSessionId: options?.passSessionId ?? false };
}

// --- Layer definition (declarative, lazy) ---

type ResolvedLayer = Layer & { _index: number };

export type LayerDefinition = {
  _name: string;
  _tools: ToolDefinition[];
  _preLayerPipeline: PreLayerPipelineStep[];
  _postLayerPipeline: PostLayerPipelineStep[];
  _preToolHandlers: PreToolNode[];
  _resolved: ResolvedLayer | null;
  tools: (tools: ToolDefinition[]) => LayerDefinition;
  onPreLayerCall: (fn: PreLayerNode | DelegateNode) => LayerDefinition;
  onPostLayerCall: (fn: PostLayerNode | DelegateNode) => LayerDefinition;
  onPreTool: (fn: PreToolNode) => LayerDefinition;
};

export function defineLayer(name: string): LayerDefinition {
  const def: LayerDefinition = {
    _name: name,
    _tools: [],
    _preLayerPipeline: [],
    _postLayerPipeline: [],
    _preToolHandlers: [],
    _resolved: null,
    tools(tools) { def._tools = tools; return def; },
    onPreLayerCall(fn) { def._preLayerPipeline.push(fn); return def; },
    onPostLayerCall(fn) { def._postLayerPipeline.push(fn); return def; },
    onPreTool(fn) { def._preToolHandlers.push(fn); return def; },
  };
  return def;
}

// --- Workflow ---

export type WorkflowConfig = {
  apiClient: Client;
  engineClient: Client;
};

export type Workflow = {
  layer: (def: LayerDefinition) => Workflow;
  /**
   * The VM hooks to export from your script.
   * Each hook validates and resolves layers on first use within that execution context.
   *
   * @example
   * export const { getTools, onPreLayerCall, onPostLayerCall, onPreTool, onTool } = workflow.hooks;
   */
  hooks: VmHooks;
};

export function createWorkflow(config: WorkflowConfig): Workflow {
  const { apiClient, engineClient } = config;
  const layerDefs: LayerDefinition[] = [];

  let cachedLayers: ResolvedLayer[] | null = null;
  let cacheAgentId: string | null = null;

  async function fetchAndResolveLayers(context: Context): Promise<void> {
    const { agentId, orchestrationId, workspaceId } = context.identity;

    if (!cachedLayers || cacheAgentId !== agentId) {
      const res = await layerFindByAgent({
        client: apiClient,
        path: { workspaceId, orchestrationId, agentId },
      });
      const layers = (res.data as { layers?: Layer[] })?.layers ?? [];
      cachedLayers = layers.map((l, i) => ({ ...l, _index: i }));
      cacheAgentId = agentId;
    }

    const missing: string[] = [];
    for (const def of layerDefs) {
      if (def._resolved) continue;
      const match = cachedLayers.find((l) => l.layer_name === def._name);
      if (!match) missing.push(def._name);
      else def._resolved = match;
    }

    if (missing.length > 0) {
      throw new Error(
        `[vm] Layers not found for agent "${context.identity.agentId}": ${missing.join(', ')}`
      );
    }
  }

  function requireResolved(def: LayerDefinition): ResolvedLayer {
    if (!def._resolved) throw new Error(`[vm] Layer "${def._name}" is not resolved.`);
    return def._resolved;
  }

  function findDefForLayerId(layerId: string): LayerDefinition | undefined {
    return layerDefs.find((d) => d._resolved?.id === layerId);
  }

  async function runPipeline(
    pipeline: (PreLayerPipelineStep | PostLayerPipelineStep)[],
    initial: PipelineValue,
    context: Context
  ): Promise<PipelineValue> {
    let value: PipelineValue = initial;
    for (const step of pipeline) {
      if (typeof step === 'function') {
        value = await (step as (v: PipelineValue, c: Context) => PipelineValue | Promise<PipelineValue>)(value, context);
      } else {
        const resolved = requireResolved(step.targetDef);
        const message = typeof value === 'string' ? value : JSON.stringify(value);
        const response: InferResponse = await sendMessages(
          context.identity.agentId,
          resolved._index,
          [{ message }],
          resolved.id!,
          engineClient,
          step.passSessionId ? context.sessionId : undefined
        );
        // Pass the response as-is: string stays string, object stays object.
        value = typeof response === 'string' ? response : response;
      }
    }
    return value;
  }

  const workflow: Workflow = {
    layer(def) {
      layerDefs.push(def);
      return workflow;
    },

    hooks: {
      async getTools(ctx) {
        await fetchAndResolveLayers(ctx);
        const def = findDefForLayerId(ctx.identity.layerId);
        if (!def) return [];
        return def._tools.map((t) => ({
          name: t.name,
          path: t.name,
          description: t.description,
          method: 'POST' as const,
          parameters: t.schema,
        }));
      },

      async onPreLayerCall(message, ctx) {
        await fetchAndResolveLayers(ctx);
        const def = findDefForLayerId(ctx.identity.layerId);
        if (!def || def._preLayerPipeline.length === 0) return message;
        const result = await runPipeline(def._preLayerPipeline, message, ctx);
        return typeof result === 'string' ? result : JSON.stringify(result);
      },

      async onPostLayerCall(text, ctx) {
        await fetchAndResolveLayers(ctx);
        const def = findDefForLayerId(ctx.identity.layerId);
        if (!def || def._postLayerPipeline.length === 0) return text;
        const result = await runPipeline(def._postLayerPipeline, text, ctx);
        return typeof result === 'string' ? result : JSON.stringify(result);
      },

      async onPreTool(payload, ctx) {
        await fetchAndResolveLayers(ctx);
        const def = findDefForLayerId(ctx.identity.layerId);
        if (!def) return payload;
        let current = payload;
        for (const handler of def._preToolHandlers) current = await handler(current, ctx);
        return current;
      },

      async onTool(payload, ctx) {
        await fetchAndResolveLayers(ctx);
        const def = findDefForLayerId(ctx.identity.layerId);
        if (!def) return null;
        const tool = def._tools.find((t) => t.name === payload.tool);
        if (!tool) return null;
        return tool.handler(payload.args, ctx);
      },
    },
  };

  return workflow;
}
