import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { linkCreate } from "@orchestration-ai/sdk/sdk.gen";
import { defaultSettings } from "./oai-sandbox.constants.ts";
import { getSandboxDescription } from "./oai-sandbox.description.ts";
import { createSession, runCommand, endSession } from "./oai-sandbox.service.ts";
import process from "node:process";

export const oaiSandboxService = defineServiceWithDynamicDescription({
  unique_name: "oai-sandbox",
  service_name: "OAI Sandbox",
  service_description: "Run shell commands in a secure Linux VM with optional OAI Files volume mounts for stateful sessions.",
  defaultSettings,
  description: getSandboxDescription,
  touch: async (context: Context, _engineClient: Client, apiClient: Client) => {
    await linkCreate({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
      body: {
        link_name: "Sandbox Env Vars",
        link_description: "Map agent settings to environment variables injected into sandbox jobs.",
        link_url: `${process.env.SELF_PUBLIC_URL}/services/oai-sandbox/config`,
      },
    });
  },
  tools: {
    create_session: createSession,
    run_command: runCommand,
    end_session: endSession,
  },
});
