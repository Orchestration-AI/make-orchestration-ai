import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import { defaultSettings } from "./oai-sandbox.constants.ts";
import { getSandboxDescription } from "./oai-sandbox.description.ts";
import { createSession, runCommand, endSession } from "./oai-sandbox.service.ts";

export const oaiSandboxService = defineServiceWithDynamicDescription({
  unique_name: "oai-sandbox",
  service_name: "OAI Sandbox",
  service_description: "Run shell commands in a secure Linux VM with optional OAI Files volume mounts for stateful sessions.",
  defaultSettings,
  description: getSandboxDescription,
  tools: {
    create_session: createSession,
    run_command: runCommand,
    end_session: endSession,
  },
});
