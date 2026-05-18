import express, { type Request, type Response, Router } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import type { Client } from "./client";
import type {
  Context,
  Permission,
  ServiceDescription,
  Setting,
} from "./shared-types";
import { createEngineClient, createApiClient, getContext } from "./services";
import { setupClientCredentials } from "./oauth-utils";
import { authDecryptPasskey } from "./sdk.gen";

// --- Types ---

export type ToolHandler = (
  body: any,
  context: Context,
  engineClient: Client,
  apiClient: Client
) => unknown | Promise<unknown>;

export type TouchHandler = (context: Context, engineClient: Client, apiClient: Client) => void | Promise<void>;

export type DescriptionHandler = (
  context: Context,
  engineClient: Client,
  apiClient: Client
) => ServiceDescription | Promise<ServiceDescription>;

type ExtractPaths<T extends ServiceDescription> = T[number]["path"];

export type ServiceDefinition<TDesc extends ServiceDescription | DescriptionHandler = ServiceDescription | DescriptionHandler> = {
  unique_name: string;
  service_name: string;
  service_description: string;
  defaultSettings?: Setting[];
  description: TDesc;
  touch?: TouchHandler;
  tools?: TDesc extends ServiceDescription
    ? Record<ExtractPaths<TDesc>, ToolHandler>
    : Record<string, ToolHandler>;
};

export function defineService<const TDesc extends ServiceDescription>(
  definition: ServiceDefinition<TDesc>
): ServiceDefinition<TDesc> {
  return definition;
}

export function defineServiceWithDynamicDescription(
  definition: ServiceDefinition<DescriptionHandler>
): ServiceDefinition<DescriptionHandler> {
  return definition;
}

export type AppConfig = {
  port?: number | string;
  permissions?: Permission[];
  engineUrl?: string;
  clientId?: string;
  accessKey?: string;
  /** Set to false to disable the /explore page. Defaults to true. */
  explore?: boolean;
};

export type OaiApp = {
  service: (definition: ServiceDefinition<any>) => OaiApp;
  permissions: (permissions: Permission[]) => OaiApp;
  listen: (port?: number | string) => HttpServer;
  expressApp: express.Application;
  httpServer: HttpServer;
};

// Re-export types consumers will need
export type { Client } from "./client";
export type { Context, Permission, ServiceDescription, Setting } from "./shared-types";
export { getBooleanSetting, getTextSetting, getSecretSetting } from "./shared-types";


// --- Explore Page ---

function renderExplorePage(services: ServiceDefinition<any>[], permissions: Permission[]): string {
  const permissionsHtml = permissions.length > 0
    ? permissions.map((p) =>
        `<div class="permission"><code>${p.permission_name}</code><span>${p.justification}</span></div>`
      ).join("")
    : `<p class="no-tools">No permissions declared</p>`;

  const serviceCards = services.map((s) => {
    const isStatic = typeof s.description !== "function";
    const tools = s.tools ? Object.keys(s.tools) : [];
    const description = isStatic ? (s.description as ServiceDescription) : null;

    let toolsHtml = "";
    if (description && description.length > 0) {
      toolsHtml = description.map((tool) => {
        const paramInputs = Object.entries(tool.parameters).map(([name, p]) => {
          const required = !p.optional ? 'required' : '';
          if (p.type === "boolean") {
            return `<label class="param-input-label"><input type="checkbox" name="${name}" data-type="boolean" />${name}${p.optional ? ' (optional)' : ''}</label>`;
          }
          return `<input class="param-input" type="text" name="${name}" placeholder="${name}${p.optional ? ' (optional)' : ''}" data-type="${p.type}" ${required} />`;
        }).join("");
        const params = Object.entries(tool.parameters).map(([name, p]) =>
          `<span class="param">${name}${p.optional ? "?" : ""}: <span class="param-type">${p.type}</span></span>`
        ).join("");
        return `<div class="tool">
          <div class="tool-header">
            <span class="method method-${tool.method.toLowerCase()}">${tool.method}</span>
            <code class="tool-path">${tool.path}</code>
            <button class="try-btn" onclick="toggleForm(this)">Try</button>
          </div>
          <p class="tool-desc">${tool.description}</p>
          ${params ? `<div class="params">${params}</div>` : ""}
          <form class="tool-form" style="display:none" onsubmit="callTool(event, '${s.unique_name}', '${tool.path}', '${tool.method}')">
            <input class="param-input layer-id-input" type="text" name="__layerId__" placeholder="X-LayerId (optional)" />
            ${paramInputs}
            <div class="form-actions">
              <button type="submit" class="call-btn">Call</button>
            </div>
            <pre class="tool-response"></pre>
          </form>
        </div>`;
      }).join("");
    } else if (tools.length > 0) {
      toolsHtml = tools.map((t) =>
        `<div class="tool">
          <div class="tool-header">
            <span class="method method-post">POST</span>
            <code class="tool-path">${t}</code>
            <button class="try-btn" onclick="toggleForm(this)">Try</button>
          </div>
          <form class="tool-form" style="display:none" onsubmit="callTool(event, '${s.unique_name}', '${t}', 'POST')">
            <input class="param-input layer-id-input" type="text" name="__layerId__" placeholder="X-LayerId (optional)" />
            <textarea class="raw-body" name="__raw__" placeholder='{ "key": "value" }' rows="3"></textarea>
            <div class="form-actions">
              <button type="submit" class="call-btn">Call</button>
            </div>
            <pre class="tool-response"></pre>
          </form>
        </div>`
      ).join("");
    } else {
      toolsHtml = `<p class="no-tools">No tools exposed</p>`;
    }

    const dynamicBadge = !isStatic ? `<span class="badge">Dynamic</span>` : "";
    const hasTouchBadge = s.touch ? `<span class="badge badge-touch">Touch</span>` : "";

    return `<div class="service-card">
      <div class="service-header">
        <h2>${s.service_name}</h2>
        <div class="badges">
          <code class="service-id">${s.unique_name}</code>
          ${dynamicBadge}${hasTouchBadge}
        </div>
      </div>
      <p class="service-desc">${s.service_description}</p>
      <div class="tools-section">
        <h3>Tools</h3>
        ${toolsHtml}
      </div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Explore Services — Orchestration AI</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --primary: #40babd;
      --primary-dark: #339597;
      --dark: #0d1117;
      --dark-2: #161b22;
      --dark-3: #1c2128;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --gradient: linear-gradient(135deg, #40babd, #75c181);
      --radius: 12px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--dark);
      color: var(--text);
      font-size: 15px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      padding: 48px 24px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .page-header {
      margin-bottom: 40px;
    }
    .page-header h1 {
      font-size: 28px;
      font-weight: 700;
      background: var(--gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .page-header p {
      color: var(--text-muted);
      margin-top: 8px;
    }
    .service-card {
      background: var(--dark-2);
      border: 1px solid var(--dark-3);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 20px;
    }
    .service-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .service-header h2 {
      font-size: 18px;
      font-weight: 600;
    }
    .badges { display: flex; align-items: center; gap: 8px; }
    .service-id {
      font-size: 12px;
      background: var(--dark-3);
      padding: 2px 8px;
      border-radius: 4px;
      color: var(--text-muted);
    }
    .badge {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(64, 186, 189, 0.15);
      color: var(--primary);
    }
    .badge-touch {
      background: rgba(117, 193, 129, 0.15);
      color: #75c181;
    }
    .service-desc {
      color: var(--text-muted);
      margin-bottom: 16px;
    }
    .tools-section h3 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 10px;
    }
    .tool {
      background: var(--dark-3);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 8px;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .method {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .method-post { background: rgba(64, 186, 189, 0.2); color: var(--primary); }
    .method-get { background: rgba(117, 193, 129, 0.2); color: #75c181; }
    .method-patch { background: rgba(255, 193, 7, 0.2); color: #ffc107; }
    .method-delete { background: rgba(248, 81, 73, 0.2); color: #f85149; }
    .method-put { background: rgba(169, 142, 255, 0.2); color: #a98eff; }
    .tool-path {
      font-size: 14px;
      font-weight: 500;
      color: var(--text);
    }
    .tool-desc {
      color: var(--text-muted);
      font-size: 13px;
      margin-top: 6px;
    }
    .params {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .param {
      font-size: 12px;
      background: var(--dark-2);
      padding: 2px 8px;
      border-radius: 4px;
      color: var(--text-muted);
    }
    .param-type { color: var(--primary); }
    .no-tools {
      color: var(--text-muted);
      font-size: 13px;
      font-style: italic;
    }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 12px;
      margin-top: 32px;
    }
    .permissions-card {
      background: var(--dark-2);
      border: 1px solid var(--dark-3);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 32px;
    }
    .permission {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--dark-3);
    }
    .permission:last-child { border-bottom: none; }
    .permission code {
      font-size: 13px;
      font-weight: 500;
      color: var(--primary);
      white-space: nowrap;
    }
    .permission span {
      font-size: 13px;
      color: var(--text-muted);
    }
    .try-btn {
      margin-left: auto;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 4px;
      border: 1px solid var(--primary);
      background: transparent;
      color: var(--primary);
      cursor: pointer;
      transition: background 0.2s;
    }
    .try-btn:hover { background: rgba(64, 186, 189, 0.1); }
    .tool-form {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .param-input, .raw-body {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--dark-3);
      background: var(--dark);
      color: var(--text);
      outline: none;
      width: 100%;
      resize: vertical;
    }
    .param-input:focus, .raw-body:focus {
      border-color: var(--primary);
    }
    .layer-id-input {
      border-style: dashed;
      font-size: 12px;
    }
    .param-input-label {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .form-actions {
      display: flex;
      gap: 8px;
    }
    .call-btn {
      font-size: 12px;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: 6px;
      border: none;
      background: var(--gradient);
      color: var(--dark);
      cursor: pointer;
    }
    .call-btn:hover { opacity: 0.9; }
    .tool-response {
      font-size: 12px;
      background: var(--dark);
      border: 1px solid var(--dark-3);
      border-radius: 6px;
      padding: 10px 12px;
      color: var(--text-muted);
      white-space: pre-wrap;
      word-break: break-all;
      display: none;
      max-height: 300px;
      overflow: auto;
    }
    .tool-response.visible { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <div class="page-header">
      <h1>Explore Services</h1>
      <p>${services.length} service${services.length !== 1 ? "s" : ""} registered</p>
    </div>
    <div class="permissions-card">
      <h3 class="section-title">Permissions</h3>
      ${permissionsHtml}
    </div>
    <h3 class="section-title">Services</h3>
    ${serviceCards}
  </div>
  <script>
    function toggleForm(btn) {
      const form = btn.closest('.tool').querySelector('.tool-form');
      const visible = form.style.display !== 'none';
      form.style.display = visible ? 'none' : 'flex';
      btn.textContent = visible ? 'Try' : 'Hide';
    }
    async function callTool(e, service, path, method) {
      e.preventDefault();
      const form = e.target;
      const responseEl = form.querySelector('.tool-response');
      const rawField = form.querySelector('[name="__raw__"]');
      const layerIdField = form.querySelector('[name="__layerId__"]');
      const layerId = layerIdField ? layerIdField.value.trim() : '';
      let body = {};
      if (rawField) {
        try { body = JSON.parse(rawField.value || '{}'); } catch { body = {}; }
      } else {
        for (const input of form.querySelectorAll('[name]')) {
          if (input.name === '__layerId__') continue;
          const name = input.name;
          const type = input.dataset.type;
          if (type === 'boolean') { body[name] = input.checked; }
          else if (type === 'number') { body[name] = Number(input.value); }
          else if (input.value) { body[name] = input.value; }
        }
      }
      responseEl.textContent = 'Calling...';
      responseEl.classList.add('visible');
      try {
        const isBodyMethod = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
        const url = '/services/' + service + '/api/' + path;
        const headers = {};
        if (isBodyMethod) { headers['Content-Type'] = 'application/json'; }
        if (layerId) { headers['X-LayerId'] = layerId; }
        const opts = { method: method.toUpperCase(), headers };
        if (isBodyMethod) { opts.body = JSON.stringify(body); }
        const res = await fetch(url, opts);
        const text = await res.text();
        try { responseEl.textContent = JSON.stringify(JSON.parse(text), null, 2); }
        catch { responseEl.textContent = text; }
      } catch (err) {
        responseEl.textContent = 'Error: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
}

// --- App Builder ---

export function createApp(config?: AppConfig): OaiApp {
  const app = express();
  const server = createServer(app);

  const services: ServiceDefinition<any>[] = [];
  let appPermissions: Permission[] = config?.permissions ?? [];

  const engineUrl = config?.engineUrl ?? process.env.ENGINE_URL ?? null;
  const clientId = config?.clientId ?? process.env.OAI_CLIENT_ID ?? "";
  const accessKey = config?.accessKey ?? process.env.OAI_ACCESS_KEY ?? "";

  const engineClient = createEngineClient(engineUrl, accessKey);

  // Context middleware
  app.use(async (req: Request, res: Response, next) => {
    const passkey = req.get("X-Passkey");

    if (passkey) {
      const apiClient = createApiClient();

      const { data: decrypted } = await authDecryptPasskey({
        body: { passkey },
        client: apiClient,
      });
      const layerId = decrypted?.data as string;
      const context = await getContext(layerId, engineClient);
      res.locals.context = context;
      res.locals.engineClient = engineClient;
      setupClientCredentials(apiClient, {
        client_id: `${clientId}:${context.identity.workspaceOwnerId}`,
        client_secret: accessKey,
      });
      res.locals.apiClient = apiClient;
    }
    next();
  });

  app.use(express.json());

  function registerService(definition: ServiceDefinition<any>) {
    services.push(definition);

    const router = Router();

    if (definition.defaultSettings) {
      router.get("/api/default-settings", (_req: Request, res: Response) => {
        res.status(200).json(definition.defaultSettings);
      });
    }

    router.get("/api/description", async (_req: Request, res: Response) => {
      try {
        const context: Context = res.locals.context;
        const desc =
          typeof definition.description === "function"
            ? await definition.description(context, res.locals.engineClient, res.locals.apiClient)
            : definition.description;
        res.status(200).json(desc);
      } catch (e) {
        console.warn(e);
        res.status(500).send(`${e}`);
      }
    });

    if (definition.touch) {
      router.post("/api/touch", async (_req: Request, res: Response) => {
        try {
          const context: Context = res.locals.context;
          await definition.touch!(context, res.locals.engineClient, res.locals.apiClient);
          res.status(204).send();
        } catch (e) {
          console.warn(e);
          res.status(500).send(`${e}`);
        }
      });
    }

    if (definition.tools) {
      for (const [toolName, handler] of Object.entries(definition.tools)) {
        const toolDesc = typeof definition.description !== "function"
          ? (definition.description as ServiceDescription).find((d) => d.path === toolName)
          : undefined;
        const method = toolDesc?.method?.toLowerCase() ?? "post";

        const routeHandler = async (req: Request, res: Response) => {
          try {
            const context: Context = res.locals.context;
            const result = await handler(req.body, context, res.locals.engineClient, res.locals.apiClient);
            if (typeof result === "string") {
              res.status(200).send(result);
            } else {
              res.status(200).json(result);
            }
          } catch (e) {
            console.warn(e);
            res.status(500).send(`${e}`);
          }
        };

        (router as any)[method](`/api/${toolName}`, routeHandler);
      }
    }

    app.use(`/services/${definition.unique_name}`, router);
  }

  function mountGlobalEndpoints() {
    app.get("/services", (_req: Request, res: Response) => {
      res.status(200).json(
        services.map((s) => ({
          unique_name: s.unique_name,
          service_name: s.service_name,
          service_description: s.service_description,
        }))
      );
    });

    app.get("/permissions", (_req: Request, res: Response) => {
      res.status(200).json(appPermissions);
    });

    if (config?.explore !== false) {
      app.get("/explore", (_req: Request, res: Response) => {
        res.status(200).send(renderExplorePage(services, appPermissions));
      });
    }
  }

  const oaiApp: OaiApp = {
    expressApp: app,
    httpServer: server,

    service(definition: ServiceDefinition<any>) {
      registerService(definition);
      return oaiApp;
    },

    permissions(permissions: Permission[]) {
      appPermissions = permissions;
      return oaiApp;
    },

    listen(port?: number | string) {
      mountGlobalEndpoints();
      const p = port ?? config?.port ?? 3001;
      server.listen(p, () => {
        console.log(`Server is running on http://localhost:${p}`);
        if (config?.explore !== false) {
          console.log(`Explore services at http://localhost:${p}/explore`);
        }
      });
      return server;
    },
  };

  return oaiApp;
}
