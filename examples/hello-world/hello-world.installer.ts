// Hello World — Orchestration AI installer definition.
//
// A fuller example: installer icon, screenshot gallery (Pexels), and
// post-install / post-uninstall lifecycle hooks that log.
//
// The workspace is chosen by the user at install time. Field names mirror the
// OAI REST API.

import { defineOrchestration } from "@orchestration-ai/sdk/installer";
import type { PostInstallContext, PostUninstallContext } from "@orchestration-ai/sdk/installer";

export const helloWorldInstaller = defineOrchestration({
  installer_name: "Hello World",
  installer_version: "1.0.0",
  publisher: {
    name: "Orchestration AI",
    url: "https://orchestration-ai.com",
    // Served from the local assets/ dir (wired via assetsDir in install.ts).
    logo_url: "/assets/logo.svg",
  },
  tagline: "The simplest possible orchestration — a single friendly assistant.",
  description_md: `
Hello World installs a minimal, ready-to-run orchestration into your
Orchestration AI workspace. It's the best starting point for learning how
installers work.

**What it sets up**

- a single **assistant** agent with one layer, and
- an editable *greeting* setting you confirm during install.

Use it as a template: clone it, add agents, layers, services, and files.
  `.trim(),
  highlights: [
    "Works out of the box",
    "One agent, one layer",
    "Fully configurable greeting",
  ],
  // Public Pexels CDN images (sized down via query params).
  screenshots: [
    "https://images.pexels.com/photos/1181671/pexels-photo-1181671.jpeg?auto=compress&cs=tinysrgb&w=800",
    "https://images.pexels.com/photos/8386440/pexels-photo-8386440.jpeg?auto=compress&cs=tinysrgb&w=800",
    "https://images.pexels.com/photos/577585/pexels-photo-577585.jpeg?auto=compress&cs=tinysrgb&w=800",
  ],
  required_scope: "role_admin",

  orchestration: {
    orchestration_name: "hello-world",
    orchestration_description: "A single friendly assistant agent.",

    // OAI files uploaded at orchestration scope (optional).
    files: [
      { path: "playbook.md", content: "# Playbook\n\nShared context for all agents." },
    ],

    agents: [
      {
        agent_name: "assistant",
        agent_description: "The primary agent.",
        vm_enabled: false,
        layers: [
          {
            layer_name: "main",
            context_md: "You are a helpful assistant for Hello World.",
            temperature: 0.7,
            // Preferred LLM by name. If the user doesn't have Claude loaded, the
            // installer falls back to a model every account is guaranteed to have.
            llm_name: "claude-sonnet-5",
            // Attach services by their logical unique_name; resolved at install time.
            // services: ["messaging", "mail"],
          },
        ],
        settings: [
          {
            setting_name: "greeting",
            setting_description: "Greeting the agent uses.",
            setting_type: "Text",
            default: "Hello!",
          },
        ],
        // Agent-scoped OAI files (optional).
        // files: [{ path: "config/defaults.json", content: "{}" }],
      },
    ],
  },

  // Post-install hook: fires once after a successful install. Here it just
  // logs — a real installer might send a greeting email or ping a webhook.
  onInstalled: async (ctx: PostInstallContext) => {
    const greeting = ctx.settings.find(
      (s) => s.agent_name === "assistant" && s.setting_name === "greeting"
    )?.value;
    console.log(
      `[hello-world] Installed in workspace ${ctx.workspaceId} ` +
        `(orchestration ${ctx.orchestrationId}). Greeting = "${greeting ?? "Hello!"}".`
    );
  },

  // Post-uninstall hook: fires once after a successful uninstall.
  onUninstalled: async (ctx: PostUninstallContext) => {
    console.log(
      `[hello-world] Uninstalled from workspace ${ctx.workspaceId} ` +
        `(orchestration ${ctx.orchestrationId}).`
    );
  },
});
