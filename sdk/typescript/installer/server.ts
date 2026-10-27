// Installer server.
//
// createInstaller(def, config) returns an Express app serving:
//   GET  /                     public landing page
//   GET  /install              authenticated wizard (also the OAuth redirect target)
//   POST /api/auth/exchange    server-side OAuth code exchange (keeps secret server-side)
//   GET  /api/workspaces       list the user's workspaces
//   GET  /steps/:id            host a custom step's HTML (sandboxed)
//   (custom step routes)       mounted under /steps/:id/...
//   POST /api/apply            run the apply engine, stream progress over SSE
//   POST /api/uninstall        run the uninstall engine
//
// Each installer has its OWN OAuth client (client_id/secret), so the consent
// screen shows the installer's registered application name. The client secret
// never leaves the server.

import express, { type Request, type Response } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createClient, createConfig, type Client } from "../client";
import { oAuthToken, workspaceFind } from "../sdk.gen";
import type { OrchestrationInstaller, CustomStepDef } from "./define";
import { validate, computeSummary } from "./define";
import { renderLanding } from "./landing";
import { renderWizard, type WizardBootstrap } from "./wizard";
import { apply, type ProgressEvent } from "./apply";
import { plan } from "./apply";
import { uninstall, loadInstallRecord, findInstalls } from "./uninstall";
import { mergeStepSettings, collectUndoState, stepClientScript, type ResolvedSetting } from "./bridge";
import { fetchAvailableLlms, buildAvailabilityReport } from "./llm";

const DEFAULT_API_BASE = "https://api.orchestration-ai.com";

export type InstallerConfig = {
  /** OAuth client id for THIS installer's registered application. */
  oauthClientId?: string;
  /** OAuth client secret for THIS installer. Never sent to the browser. */
  oauthClientSecret?: string;
  /** Public redirect URI registered for this installer (points at /install). */
  oauthRedirectUri?: string;
  /** API base URL. Defaults to production. */
  apiBaseUrl?: string;
  /** Route prefix if mounted under a path (e.g. "/install"). Defaults to "". */
  basePath?: string;
  /**
   * Optional local directory served at `${basePath}/assets`. Use it to host an
   * installer icon or screenshots referenced from `publisher.logo_url` /
   * `screenshots` (e.g. logo_url: "/assets/logo.svg").
   */
  assetsDir?: string;
  port?: number | string;
};

export type Installer = {
  expressApp: express.Application;
  httpServer: HttpServer;
  listen: (port?: number | string) => HttpServer;
};

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

/** Build an API client bound to a user access token. */
function userClient(apiBaseUrl: string, token: string): Client {
  return createClient(createConfig({
    baseUrl: apiBaseUrl,
    headers: { Authorization: `Bearer ${token}` },
  }));
}

/** Resolve a custom step's HTML (inline string or a bundled .html file path). */
async function resolveStepHtml(step: CustomStepDef): Promise<string> {
  const raw = step.html.trim();
  const looksLikePath = !raw.startsWith("<") && raw.endsWith(".html");
  if (looksLikePath && existsSync(raw)) {
    return await readFile(raw, "utf8");
  }
  return step.html;
}

export function createInstaller(def: OrchestrationInstaller, config: InstallerConfig = {}): Installer {
  const issues = validate(def);
  if (issues.length) {
    const msg = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    throw new Error(`Invalid orchestration installer definition:\n${msg}`);
  }

  const apiBaseUrl = config.apiBaseUrl ?? env("OAI_API_URL") ?? DEFAULT_API_BASE;
  const basePath = (config.basePath ?? "").replace(/\/$/, "");
  const oauthClientId = config.oauthClientId ?? env("INSTALLER_OAUTH_CLIENT_ID") ?? "";
  const oauthClientSecret = config.oauthClientSecret ?? env("INSTALLER_OAUTH_CLIENT_SECRET") ?? "";
  const oauthRedirectUri = config.oauthRedirectUri ?? env("INSTALLER_OAUTH_REDIRECT_URI") ?? "";
  const requiredScope = def.required_scope ?? "role_admin";

  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "5mb" }));

  const steps = new Map<string, CustomStepDef>((def.customSteps ?? []).map((s) => [s.id, s]));

  // --- Static assets (optional): installer icon, screenshots, etc. ---
  const assetsDir = config.assetsDir ?? env("INSTALLER_ASSETS_DIR");
  if (assetsDir) {
    app.use(`${basePath}/assets`, express.static(assetsDir));
  }

  // --- Public landing page ---
  app.get(`${basePath}/`, (_req, res) => {
    res.type("html").send(renderLanding(def, `${basePath}/install`));
  });

  // --- Wizard (also the OAuth redirect target) ---
  app.get(`${basePath}/install`, (_req, res) => {
    const settings: WizardBootstrap["settings"] = [];
    for (const agent of def.orchestration.agents ?? []) {
      for (const s of agent.settings ?? []) {
        settings.push({
          agent_name: agent.agent_name,
          setting_name: s.setting_name,
          setting_description: s.setting_description,
          setting_type: s.setting_type,
          default: s.default ?? (s.setting_type === "Boolean" ? false : ""),
          locked: Boolean(s.locked),
        });
      }
    }
    const bootstrap: WizardBootstrap = {
      installerName: def.installer_name,
      installerVersion: def.installer_version,
      requiredScope,
      apiBaseUrl,
      oauthClientId,
      oauthRedirectUri: oauthRedirectUri || `${firstOrigin(_req)}${basePath}/install`,
      basePath,
      plan: plan(def).items,
      summary: computeSummary(def),
      settings,
      customSteps: (def.customSteps ?? []).map((s) => ({ id: s.id, title: s.title, description_md: s.description_md })),
    };
    res.type("html").send(renderWizard(def, bootstrap));
  });

  // --- Server-side OAuth code exchange ---
  app.post(`${basePath}/api/auth/exchange`, async (req: Request, res: Response) => {
    try {
      const { code, redirect_uri } = req.body ?? {};
      if (!code) return res.status(400).json({ error: "code is required" });
      const tokenClient = createClient(createConfig({ baseUrl: apiBaseUrl }));
      const { data, error } = await oAuthToken({
        client: tokenClient,
        body: {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect_uri ?? oauthRedirectUri,
          client_id: oauthClientId,
          client_secret: oauthClientSecret,
        },
      });
      if (error || !data?.access_token) return res.status(400).json({ error: "token exchange failed" });
      res.json({
        access_token: data.access_token,
        token_type: data.token_type ?? "Bearer",
        expires_in: data.expires_in ?? 3600,
        scope: data.scope,
      });
    } catch (e) {
      res.status(500).json({ error: `${e}` });
    }
  });

  // --- Workspace list ---
  app.get(`${basePath}/api/workspaces`, async (req: Request, res: Response) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    try {
      const { data, error } = await workspaceFind({ client: userClient(apiBaseUrl, token) });
      if (error) return res.status(400).json({ error: "workspace list failed" });
      res.json({
        workspaces: (data?.workspaces ?? []).map((w) => ({ id: w.id, workspace_name: w.workspace_name })),
      });
    } catch (e) {
      res.status(500).json({ error: `${e}` });
    }
  });

  // --- Discover existing installs of THIS installer in a workspace ---
  // Enables cross-session uninstall: on return, the user picks a workspace and
  // we find orchestrations carrying this installer's `.installer-state.json`.
  app.get(`${basePath}/api/installs`, async (req: Request, res: Response) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const workspaceId = String(req.query.workspaceId ?? "");
    if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
    try {
      const installs = await findInstalls(userClient(apiBaseUrl, token), workspaceId, def.installer_name);
      res.json({ installs });
    } catch (e) {
      res.status(500).json({ error: `${e}` });
    }
  });

  // --- LLM availability preflight ---
  // Reports, per layer, which LLM is requested and whether a fallback will be
  // applied for this user. The wizard calls this (and re-calls it on refresh)
  // so users can load keys before continuing. Requires the user token so it
  // reflects the LLMs they actually have.
  app.get(`${basePath}/api/llm-availability`, async (req: Request, res: Response) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    try {
      const available = await fetchAvailableLlms(userClient(apiBaseUrl, token));
      res.json(buildAvailabilityReport(def, available));
    } catch (e) {
      res.status(500).json({ error: `${e}` });
    }
  });

  // --- Custom step hosting ---
  for (const step of steps.values()) {
    // The step's HTML, with the client helper injected.
    app.get(`${basePath}/steps/${encodeURIComponent(step.id)}`, async (_req, res) => {
      try {
        const html = await resolveStepHtml(step);
        const injected = `<script>${stepClientScript(step.id)}</script>`;
        const doc = html.includes("</head>")
          ? html.replace("</head>", `${injected}</head>`)
          : `${injected}${html}`;
        res.type("html").send(doc);
      } catch (e) {
        res.status(500).send(`step load failed: ${e}`);
      }
    });

    // Developer-defined routes (e.g. third-party OAuth callbacks).
    for (const [spec, handler] of Object.entries(step.routes ?? {})) {
      const [method, routePath] = spec.split(/\s+/, 2);
      const full = `${basePath}/steps/${encodeURIComponent(step.id)}${routePath}`;
      const m = (method || "GET").toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
      (app as any)[m](full, (req: Request, resp: Response) => handler(req, resp));
    }
  }

  // --- Apply (SSE) ---
  app.post(`${basePath}/api/apply`, async (req: Request, res: Response) => {
    const token = bearer(req) ?? req.body?.token;
    if (!token) return res.status(401).json({ error: "unauthorized" });

    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders?.();
    const send = (e: ProgressEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

    try {
      const client = userClient(apiBaseUrl, token);
      const { workspaceId, createWorkspaceName, settings, stepResults } = req.body ?? {};

      // Build resolved settings: review edits, then merge custom-step outputs.
      const base: ResolvedSetting[] = (settings ?? []).map((s: any) => ({
        agent_name: s.agent_name,
        setting_name: s.setting_name,
        setting_description: s.setting_description ?? "",
        setting_type: s.setting_type,
        value: s.value,
      }));
      const resolved = mergeStepSettings(base, stepResults ?? [], def);
      const undo = collectUndoState(stepResults ?? []);

      await apply(def, {
        client,
        workspaceId: workspaceId || undefined,
        createWorkspaceName: createWorkspaceName || undefined,
        settings: resolved,
        customStepUndo: undo,
        runStepUninstall: async (stepId, undo_state, ctx) => {
          const step = steps.get(stepId);
          if (step?.uninstall) {
            await step.uninstall({ apiClient: client, workspaceId: ctx.workspaceId, orchestrationId: ctx.orchestrationId, undo_state });
          }
        },
        onProgress: send,
      });
    } catch (e) {
      send({ phase: "error", message: `${e}` });
    } finally {
      res.end();
    }
  });

  // --- Uninstall ---
  app.post(`${basePath}/api/uninstall`, async (req: Request, res: Response) => {
    const token = bearer(req) ?? req.body?.token;
    if (!token) return res.status(401).json({ error: "unauthorized" });
    try {
      const client = userClient(apiBaseUrl, token);
      const { workspaceId, orchestrationId } = req.body ?? {};
      if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });

      // Resolve the orchestration id: provided, or discover via the install record.
      let oId = orchestrationId as string | undefined;
      if (!oId) return res.status(400).json({ error: "orchestrationId is required" });

      const record = await loadInstallRecord(client, workspaceId, oId);
      if (!record) return res.status(404).json({ error: "install record not found" });

      await uninstall({ client, record, def });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: `${e}` });
    }
  });

  const installer: Installer = {
    expressApp: app,
    httpServer: server,
    listen(port?: number | string) {
      const p = port ?? config.port ?? 3002;
      server.listen(p, () => {
        console.log(`Installer "${def.installer_name}" running on http://localhost:${p}${basePath}/`);
      });
      return server;
    },
  };
  return installer;
}

function bearer(req: Request): string | null {
  const h = req.get("Authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return null;
}

function firstOrigin(req: Request): string {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0];
  const host = req.get("host") || "localhost";
  return `${proto}://${host}`;
}

// Re-exports for convenience.
export { defineOrchestration } from "./define";
export {
  GUARANTEED_LLMS,
  ULTIMATE_FALLBACK_LLM,
  LLM_KEYS_URL,
  resolveLlm,
  buildAvailabilityReport,
} from "./llm";
export type {
  AvailableLlm,
  LlmResolution,
  LayerLlmAvailability,
  LlmAvailabilityReport,
} from "./llm";
export type {
  OrchestrationInstaller,
  CustomStepDef,
  CustomStepUninstallContext,
  CustomStepResult,
  PostInstallContext,
  PostUninstallContext,
  PostInstallHandler,
  PostUninstallHandler,
  AppliedSetting,
  FileDef,
  AgentDef,
  LayerDef,
  SettingDef,
} from "./define";
