// Sales Copilot — example Orchestration AI installer.
//
// Demonstrates the installer framework: a multi-agent orchestration with
// layers, agent-scoped settings (including a Secret), orchestration + agent
// files, and a custom third-party connection step with teardown.
//
// Install link flow: landing page -> OAuth (role_admin) -> review -> choose
// workspace -> connect CRM -> confirm -> apply. Uninstall removes the
// orchestration and revokes the CRM connection.

import { defineOrchestration } from "@orchestration-ai/sdk/installer";
import type { PostInstallContext, PostUninstallContext } from "@orchestration-ai/sdk/installer";
import { connectCrmStep } from "./custom-steps/connect-crm";

export const salesCopilotInstaller = defineOrchestration({
  installer_name: "Sales Copilot",
  installer_version: "1.0.0",
  publisher: {
    name: "Orchestration AI",
    url: "https://orchestration-ai.com",
  },
  tagline: "An AI sales team that triages leads and drafts follow-ups.",
  description_md: `
Sales Copilot installs a two-agent orchestration into your workspace:

- a **Triage** agent that classifies inbound leads, and
- a **Follow-up** agent that drafts personalised replies.

You connect your CRM during setup. Everything can be removed on uninstall.
  `.trim(),
  highlights: [
    "24/7 lead triage",
    "Auto-drafted follow-ups",
    "Connects to your CRM",
  ],
  required_scope: "role_admin",

  orchestration: {
    orchestration_name: "sales-copilot",
    orchestration_description: "Triages inbound leads and drafts follow-ups.",

    // Shared playbook available to every agent.
    files: [
      {
        path: "playbook.md",
        content: "# Sales Playbook\n\nQualify on budget, authority, need, timeline.",
      },
    ],

    agents: [
      {
        agent_name: "triage",
        agent_description: "Classifies and routes inbound leads.",
        layers: [
          {
            layer_name: "classify",
            context_md: "Classify each lead as hot, warm, or cold and explain why.",
            temperature: 0.3,
            services: ["pdthd6GUsAhOpT4vQlPO_messaging"],
          },
        ],
        settings: [
          {
            setting_name: "crm_region",
            setting_description: "CRM data region.",
            setting_type: "Text",
            default: "eu",
          },
        ],
        files: [
          { path: "config/routing.json", content: JSON.stringify({ hot: "sales", cold: "nurture" }, null, 2) },
        ],
      },
      {
        agent_name: "follow-up",
        agent_description: "Drafts follow-up messages for qualified leads.",
        layers: [
          {
            layer_name: "draft",
            context_md: "Write a concise, friendly follow-up. Never invent facts.",
            temperature: 0.7,
            services: ["pdthd6GUsAhOpT4vQlPO_messaging", "pdthd6GUsAhOpT4vQlPO_mail"],
          },
        ],
        settings: [
          {
            setting_name: "sender_name",
            setting_description: "Name used to sign messages.",
            setting_type: "Text",
            default: "The Sales Team",
          },
          {
            // Populated by the custom CRM connection step.
            setting_name: "crm_api_key",
            setting_description: "CRM API key (set during setup).",
            setting_type: "Secret",
            default: "",
          },
        ],
      },
    ],
  },

  customSteps: [connectCrmStep],

  // Fires once after a successful install — e.g. send a greeting email to the
  // client. A failure here is reported but does not roll back the install.
  onInstalled: async (ctx: PostInstallContext) => {
    const senderName = ctx.settings.find(
      (s) => s.agent_name === "follow-up" && s.setting_name === "sender_name"
    )?.value;
    // Ping your third-party system here (email provider, Slack, CRM, ...).
    console.log(
      `Sales Copilot installed in workspace ${ctx.workspaceId} (orchestration ${ctx.orchestrationId}). ` +
        `Sending greeting as "${senderName ?? "The Sales Team"}".`
    );
  },

  // Fires once after a successful uninstall.
  onUninstalled: async (ctx: PostUninstallContext) => {
    console.log(`Sales Copilot removed from workspace ${ctx.workspaceId}.`);
  },
});
