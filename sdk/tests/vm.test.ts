import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  defineTool,
  defineLayer,
  delegateTo,
  createWorkflow,
} from '../typescript/vm';
import type { Context, LayerDefinition, ToolPayload } from '../typescript/vm';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const makeContext = (layerId: string, sessionId?: string): Context => ({
  identity: {
    agentId: 'agent-1',
    agentName: 'Test Agent',
    layerId,
    layerIndex: 0,
    numberOfLayers: 2,
    orchestrationId: 'orch-1',
    workspaceId: 'ws-1',
    workspaceOwnerId: 'owner-1',
  },
  sessionId,
});

const makeApiLayer = (id: string, name: string) => ({
  id,
  layer_name: name,
  created_at: '2024-01-01T00:00:00Z',
});

// Builds a mock apiClient whose layerFindByAgent returns the given layers.
const makeApiClient = (layers: ReturnType<typeof makeApiLayer>[]) =>
  ({ get: vi.fn().mockResolvedValue({ data: { layers } }) } as any);

// Builds a mock engineClient whose sendMessages returns the given response.
const makeEngineClient = (response: string | object = 'engine-response') =>
  ({ get: vi.fn(), post: vi.fn().mockResolvedValue({ data: response }) } as any);

// ---------------------------------------------------------------------------
// defineTool
// ---------------------------------------------------------------------------

describe('defineTool', () => {
  it('stores name, description, schema and handler', () => {
    const handler = vi.fn();
    const schema = { input: { type: 'string' as const, optional: false, description: 'x' } };
    const tool = defineTool('my-tool', 'Does a thing', schema, handler);

    expect(tool.name).toBe('my-tool');
    expect(tool.description).toBe('Does a thing');
    expect(tool.schema).toBe(schema);
    expect(tool.handler).toBe(handler);
  });
});

// ---------------------------------------------------------------------------
// defineLayer
// ---------------------------------------------------------------------------

describe('defineLayer', () => {
  it('initialises with correct name and empty state', () => {
    const layer = defineLayer('my-layer');
    expect(layer._name).toBe('my-layer');
    expect(layer._tools).toEqual([]);
    expect(layer._preLayerPipeline).toEqual([]);
    expect(layer._postLayerPipeline).toEqual([]);
    expect(layer._preToolHandlers).toEqual([]);
    expect(layer._resolved).toBeNull();
  });

  it('chains .tools() and stores them', () => {
    const tool = defineTool('t', 'desc', {}, vi.fn());
    const layer = defineLayer('l').tools([tool]);
    expect(layer._tools).toEqual([tool]);
  });

  it('chains multiple .onPreLayerCall() steps in order', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const layer = defineLayer('l').onPreLayerCall(fn1).onPreLayerCall(fn2);
    expect(layer._preLayerPipeline).toEqual([fn1, fn2]);
  });

  it('chains multiple .onPostLayerCall() steps in order', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const layer = defineLayer('l').onPostLayerCall(fn1).onPostLayerCall(fn2);
    expect(layer._postLayerPipeline).toEqual([fn1, fn2]);
  });

  it('chains multiple .onPreTool() handlers in order', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const layer = defineLayer('l').onPreTool(fn1).onPreTool(fn2);
    expect(layer._preToolHandlers).toEqual([fn1, fn2]);
  });

  it('returns the same instance for all chain calls', () => {
    const layer = defineLayer('l');
    expect(layer.tools([])).toBe(layer);
    expect(layer.onPreLayerCall(vi.fn())).toBe(layer);
    expect(layer.onPostLayerCall(vi.fn())).toBe(layer);
    expect(layer.onPreTool(vi.fn())).toBe(layer);
  });
});

// ---------------------------------------------------------------------------
// delegateTo
// ---------------------------------------------------------------------------

describe('delegateTo', () => {
  it('holds a direct reference to the LayerDefinition', () => {
    const target = defineLayer('target');
    const node = delegateTo(target);
    expect(node._type).toBe('delegate');
    expect(node.targetDef).toBe(target);
  });

  it('defaults passSessionId to false', () => {
    const node = delegateTo(defineLayer('t'));
    expect(node.passSessionId).toBe(false);
  });

  it('sets passSessionId to true when specified', () => {
    const node = delegateTo(defineLayer('t'), { passSessionId: true });
    expect(node.passSessionId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createWorkflow — layer registration
// ---------------------------------------------------------------------------

describe('createWorkflow', () => {
  it('returns a workflow with a hooks object', () => {
    const wf = createWorkflow({ apiClient: makeApiClient([]), engineClient: makeEngineClient() });
    expect(wf.hooks).toBeDefined();
    expect(typeof wf.hooks.getTools).toBe('function');
    expect(typeof wf.hooks.onPreLayerCall).toBe('function');
    expect(typeof wf.hooks.onPostLayerCall).toBe('function');
    expect(typeof wf.hooks.onPreTool).toBe('function');
    expect(typeof wf.hooks.onTool).toBe('function');
  });

  it('.layer() returns the workflow for chaining', () => {
    const wf = createWorkflow({ apiClient: makeApiClient([]), engineClient: makeEngineClient() });
    expect(wf.layer(defineLayer('l'))).toBe(wf);
  });
});

// ---------------------------------------------------------------------------
// Validation — missing layers
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('throws when a declared layer is not found in the API response', async () => {
    const layer = defineLayer('missing-layer');
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('id-1', 'other-layer')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    await expect(wf.hooks.getTools(makeContext('id-1'))).rejects.toThrow(
      '[vm] Layers not found for agent "agent-1": missing-layer'
    );
  });

  it('does not throw when all declared layers are found', async () => {
    const layer = defineLayer('my-layer');
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('layer-id-1', 'my-layer')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    await expect(wf.hooks.getTools(makeContext('layer-id-1'))).resolves.not.toThrow();
  });

  it('throws listing all missing layers at once', async () => {
    const wf = createWorkflow({
      apiClient: makeApiClient([]),
      engineClient: makeEngineClient(),
    })
      .layer(defineLayer('layer-a'))
      .layer(defineLayer('layer-b'));

    await expect(wf.hooks.getTools(makeContext('x'))).rejects.toThrow('layer-a, layer-b');
  });
});

// ---------------------------------------------------------------------------
// getTools
// ---------------------------------------------------------------------------

describe('hooks.getTools', () => {
  it('returns empty array when context layerId does not match any registered layer', async () => {
    const layer = defineLayer('my-layer');
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('layer-id-1', 'my-layer')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const tools = await wf.hooks.getTools(makeContext('unrelated-layer-id'));
    expect(tools).toEqual([]);
  });

  it('returns mapped VmToolDefinitions for the matching layer', async () => {
    const schema = { q: { type: 'string' as const, optional: false, description: 'query' } };
    const tool = defineTool('search', 'Search things', schema, vi.fn());
    const layer = defineLayer('my-layer').tools([tool]);

    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('layer-id-1', 'my-layer')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const tools = await wf.hooks.getTools(makeContext('layer-id-1'));
    expect(tools).toEqual([
      { path: 'search', name: 'search', description: 'Search things', method: 'POST', parameters: schema },
    ]);
  });

  it('returns tools only for the layer matching the current context', async () => {
    const toolA = defineTool('tool-a', 'A', {}, vi.fn());
    const toolB = defineTool('tool-b', 'B', {}, vi.fn());
    const layerA = defineLayer('layer-a').tools([toolA]);
    const layerB = defineLayer('layer-b').tools([toolB]);

    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('id-a', 'layer-a'),
        makeApiLayer('id-b', 'layer-b'),
      ]),
      engineClient: makeEngineClient(),
    })
      .layer(layerA)
      .layer(layerB);

    const toolsForA = await wf.hooks.getTools(makeContext('id-a'));
    expect(toolsForA.map((t) => t.path)).toEqual(['tool-a']);

    const toolsForB = await wf.hooks.getTools(makeContext('id-b'));
    expect(toolsForB.map((t) => t.path)).toEqual(['tool-b']);
  });
});

// ---------------------------------------------------------------------------
// onPreLayerCall
// ---------------------------------------------------------------------------

describe('hooks.onPreLayerCall', () => {
  it('returns the message unchanged when no pipeline is defined', async () => {
    const layer = defineLayer('l');
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreLayerCall('hello', makeContext('lid'));
    expect(result).toBe('hello');
  });

  it('returns the message unchanged when context does not match any layer', async () => {
    const layer = defineLayer('l').onPreLayerCall((msg) => `modified: ${msg}`);
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreLayerCall('hello', makeContext('other-id'));
    expect(result).toBe('hello');
  });

  it('runs pipeline steps in order, passing output of each to the next', async () => {
    const layer = defineLayer('l')
      .onPreLayerCall((msg) => `${msg}-step1`)
      .onPreLayerCall((msg) => `${msg}-step2`);

    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreLayerCall('start', makeContext('lid'));
    expect(result).toBe('start-step1-step2');
  });

  it('supports async pipeline steps', async () => {
    const layer = defineLayer('l')
      .onPreLayerCall(async (msg) => `${msg}-async`);

    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreLayerCall('msg', makeContext('lid'));
    expect(result).toBe('msg-async');
  });

  it('JSON-stringifies a non-string final pipeline result', async () => {
    const layer = defineLayer('l')
      .onPreLayerCall(() => ({ structured: true }));

    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreLayerCall('msg', makeContext('lid'));
    expect(result).toBe('{"structured":true}');
  });

  it('delegate step calls sendMessages and passes response to next step', async () => {
    const targetLayer = defineLayer('target');
    const sourceLayer = defineLayer('source')
      .onPreLayerCall(delegateTo(targetLayer))
      .onPreLayerCall((val) => `after-delegate:${val}`);

    const engineClient = makeEngineClient('delegate-response');
    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('source-id', 'source'),
        makeApiLayer('target-id', 'target'),
      ]),
      engineClient,
    })
      .layer(sourceLayer)
      .layer(targetLayer);

    const result = await wf.hooks.onPreLayerCall('original', makeContext('source-id'));
    expect(result).toBe('after-delegate:delegate-response');
    expect(engineClient.post).toHaveBeenCalledOnce();
  });

  it('delegate step does not pass sessionId by default', async () => {
    const targetLayer = defineLayer('target');
    const sourceLayer = defineLayer('source').onPreLayerCall(delegateTo(targetLayer));

    const engineClient = makeEngineClient('resp');
    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('source-id', 'source'),
        makeApiLayer('target-id', 'target'),
      ]),
      engineClient,
    })
      .layer(sourceLayer)
      .layer(targetLayer);

    await wf.hooks.onPreLayerCall('msg', makeContext('source-id', 'session-abc'));

    const callArgs = engineClient.post.mock.calls[0][0];
    // sendMessages passes sessionId as x-session-id header — undefined means not passed
    expect(callArgs.headers?.['x-session-id']).toBeUndefined();
  });

  it('delegate step passes sessionId when passSessionId is true', async () => {
    const targetLayer = defineLayer('target');
    const sourceLayer = defineLayer('source')
      .onPreLayerCall(delegateTo(targetLayer, { passSessionId: true }));

    const engineClient = makeEngineClient('resp');
    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('source-id', 'source'),
        makeApiLayer('target-id', 'target'),
      ]),
      engineClient,
    })
      .layer(sourceLayer)
      .layer(targetLayer);

    await wf.hooks.onPreLayerCall('msg', makeContext('source-id', 'session-abc'));

    const callArgs = engineClient.post.mock.calls[0][0];
    expect(callArgs.headers?.['x-session-id']).toBe('session-abc');
  });

  it('delegate step passes object value as JSON string to sendMessages', async () => {
    const targetLayer = defineLayer('target');
    const sourceLayer = defineLayer('source')
      .onPreLayerCall(() => ({ key: 'value' }))
      .onPreLayerCall(delegateTo(targetLayer));

    const engineClient = makeEngineClient('ok');
    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('source-id', 'source'),
        makeApiLayer('target-id', 'target'),
      ]),
      engineClient,
    })
      .layer(sourceLayer)
      .layer(targetLayer);

    await wf.hooks.onPreLayerCall('msg', makeContext('source-id'));

    const callArgs = engineClient.post.mock.calls[0][0];
    expect(JSON.parse(callArgs.body[0].message)).toEqual({ key: 'value' });
  });

  it('delegate step passes object response as-is to the next step', async () => {
    const targetLayer = defineLayer('target');
    const received: unknown[] = [];
    const sourceLayer = defineLayer('source')
      .onPreLayerCall(delegateTo(targetLayer))
      .onPreLayerCall((val) => { received.push(val); return val; });

    const engineClient = makeEngineClient({ message: 'structured', media: [] });
    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('source-id', 'source'),
        makeApiLayer('target-id', 'target'),
      ]),
      engineClient,
    })
      .layer(sourceLayer)
      .layer(targetLayer);

    await wf.hooks.onPreLayerCall('msg', makeContext('source-id'));
    expect(received[0]).toEqual({ message: 'structured', media: [] });
  });
});

// ---------------------------------------------------------------------------
// onPostLayerCall
// ---------------------------------------------------------------------------

describe('hooks.onPostLayerCall', () => {
  it('returns text unchanged when no pipeline is defined', async () => {
    const layer = defineLayer('l');
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPostLayerCall('response text', makeContext('lid'));
    expect(result).toBe('response text');
  });

  it('runs post-layer pipeline steps in order', async () => {
    const layer = defineLayer('l')
      .onPostLayerCall((t) => `${t}-A`)
      .onPostLayerCall((t) => `${t}-B`);

    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPostLayerCall('text', makeContext('lid'));
    expect(result).toBe('text-A-B');
  });

  it('delegate step in post pipeline calls sendMessages', async () => {
    const summaryLayer = defineLayer('summary');
    const mainLayer = defineLayer('main')
      .onPostLayerCall(delegateTo(summaryLayer));

    const engineClient = makeEngineClient('summarised');
    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('main-id', 'main'),
        makeApiLayer('summary-id', 'summary'),
      ]),
      engineClient,
    })
      .layer(mainLayer)
      .layer(summaryLayer);

    const result = await wf.hooks.onPostLayerCall('long text', makeContext('main-id'));
    expect(result).toBe('summarised');
    expect(engineClient.post).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// onPreTool
// ---------------------------------------------------------------------------

describe('hooks.onPreTool', () => {
  const payload: ToolPayload = { tool: 'my-tool', args: { x: 1 } };

  it('returns payload unchanged when no handlers are defined', async () => {
    const layer = defineLayer('l');
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreTool(payload, makeContext('lid'));
    expect(result).toEqual(payload);
  });

  it('returns payload unchanged when context does not match any layer', async () => {
    const layer = defineLayer('l').onPreTool((p) => ({ ...p, args: { injected: true } }));
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreTool(payload, makeContext('other-id'));
    expect(result).toEqual(payload);
  });

  it('chains pre-tool handlers in order', async () => {
    const layer = defineLayer('l')
      .onPreTool((p) => ({ ...p, args: { ...p.args, step: 'first' } }))
      .onPreTool((p) => ({ ...p, args: { ...p.args, step: 'second' } }));

    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onPreTool(payload, makeContext('lid'));
    expect(result.args.step).toBe('second');
  });

  it('throwing inside a handler propagates the error', async () => {
    const layer = defineLayer('l')
      .onPreTool(() => { throw new Error('blocked'); });

    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    await expect(wf.hooks.onPreTool(payload, makeContext('lid'))).rejects.toThrow('blocked');
  });
});

// ---------------------------------------------------------------------------
// onTool
// ---------------------------------------------------------------------------

describe('hooks.onTool', () => {
  it('returns null when context does not match any layer', async () => {
    const tool = defineTool('t', 'd', {}, vi.fn().mockResolvedValue('result'));
    const layer = defineLayer('l').tools([tool]);
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onTool({ tool: 't', args: {} }, makeContext('other-id'));
    expect(result).toBeNull();
  });

  it('returns null when tool name is not found on the layer', async () => {
    const layer = defineLayer('l');
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onTool({ tool: 'unknown', args: {} }, makeContext('lid'));
    expect(result).toBeNull();
  });

  it('routes to the correct tool handler and returns its result', async () => {
    const handler = vi.fn().mockResolvedValue({ answer: 42 });
    const tool = defineTool('calculate', 'desc', {}, handler);
    const layer = defineLayer('l').tools([tool]);
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    const result = await wf.hooks.onTool({ tool: 'calculate', args: { n: 6 } }, makeContext('lid'));
    expect(result).toEqual({ answer: 42 });
    expect(handler).toHaveBeenCalledWith({ n: 6 }, expect.objectContaining({ identity: expect.any(Object) }));
  });

  it('routes to the correct tool when multiple tools are registered', async () => {
    const handlerA = vi.fn().mockResolvedValue('a');
    const handlerB = vi.fn().mockResolvedValue('b');
    const layer = defineLayer('l').tools([
      defineTool('tool-a', 'd', {}, handlerA),
      defineTool('tool-b', 'd', {}, handlerB),
    ]);
    const wf = createWorkflow({
      apiClient: makeApiClient([makeApiLayer('lid', 'l')]),
      engineClient: makeEngineClient(),
    }).layer(layer);

    expect(await wf.hooks.onTool({ tool: 'tool-a', args: {} }, makeContext('lid'))).toBe('a');
    expect(await wf.hooks.onTool({ tool: 'tool-b', args: {} }, makeContext('lid'))).toBe('b');
    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// API caching
// ---------------------------------------------------------------------------

describe('API caching', () => {
  it('calls layerFindByAgent only once per hook invocation even with multiple hooks called', async () => {
    const layer = defineLayer('l');
    const apiClient = makeApiClient([makeApiLayer('lid', 'l')]);
    const wf = createWorkflow({ apiClient, engineClient: makeEngineClient() }).layer(layer);
    const ctx = makeContext('lid');

    // Each hook call is a fresh execution context — cache is module-level per workflow instance.
    // Within the same workflow instance, the second call should use the cache.
    await wf.hooks.getTools(ctx);
    await wf.hooks.getTools(ctx);

    expect(apiClient.get).toHaveBeenCalledOnce();
  });

  it('re-fetches when agentId changes between calls', async () => {
    const layer = defineLayer('l');
    const apiClient = makeApiClient([
      makeApiLayer('lid-1', 'l'),
      makeApiLayer('lid-2', 'l'),
    ]);
    const wf = createWorkflow({ apiClient, engineClient: makeEngineClient() }).layer(layer);

    const ctx1 = makeContext('lid-1');
    const ctx2 = {
      ...makeContext('lid-2'),
      identity: { ...makeContext('lid-2').identity, agentId: 'agent-2' },
    };

    await wf.hooks.getTools(ctx1);
    // Reset _resolved so the second agent's layers can be resolved
    layer._resolved = null;
    await wf.hooks.getTools(ctx2);

    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// delegate — uses correct layerIndex from API response order
// ---------------------------------------------------------------------------

describe('delegate layerIndex', () => {
  it('uses the index of the target layer as returned by the API', async () => {
    const targetLayer = defineLayer('target');
    const sourceLayer = defineLayer('source').onPreLayerCall(delegateTo(targetLayer));

    const engineClient = makeEngineClient('ok');
    // target is at index 1 in the API response
    const wf = createWorkflow({
      apiClient: makeApiClient([
        makeApiLayer('source-id', 'source'),
        makeApiLayer('target-id', 'target'),
      ]),
      engineClient,
    })
      .layer(sourceLayer)
      .layer(targetLayer);

    await wf.hooks.onPreLayerCall('msg', makeContext('source-id'));

    const callArgs = engineClient.post.mock.calls[0][0];
    // sendMessages URL contains the layerIndex: /agents/{agentId}/layers/{layerIndex}/messages
    expect(callArgs.url).toContain('/layers/1/');
  });
});
