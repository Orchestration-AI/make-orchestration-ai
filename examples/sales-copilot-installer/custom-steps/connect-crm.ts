// CRM connection step for Sales Copilot.
//
// Renders a connect button in the wizard, hosts a callback route for the CRM's
// OAuth, emits the resulting API key as a Secret setting on the follow-up
// agent, and revokes the connection on uninstall.

import type { CustomStepDef, CustomStepUninstallContext } from "@orchestration-ai/sdk/installer";
import type { Request, Response } from "express";

export const connectCrmStep: CustomStepDef = {
  id: "connect-crm",
  title: "Connect your CRM",
  description_md: "Authorize Sales Copilot to read leads and write follow-ups.",
  html: "./custom-steps/connect-crm.html",

  routes: {
    // The CRM redirects here after the user authorizes. In a real integration
    // you'd exchange `req.query.code` for an API key, then post the result back
    // to the wizard. For the example we short-circuit with a demo key.
    "GET /callback": async (_req: Request, res: Response) => {
      const connectionId = `conn_${Date.now()}`;
      res.type("html").send(`<!doctype html><script>
        window.parent && window.parent.postMessage({
          type: "oai:step-result",
          stepId: "connect-crm",
          result: {
            settings: [{
              agent_name: "follow-up",
              setting_name: "crm_api_key",
              setting_type: "Secret",
              value: "demo-crm-key"
            }],
            undo_state: { connection_id: ${JSON.stringify(connectionId)} }
          }
        }, window.location.origin);
        document.body.innerHTML = "CRM connected. You can return to the wizard.";
      </script>`);
    },
  },

  uninstall: async (ctx: CustomStepUninstallContext) => {
    const connectionId = ctx.undo_state.connection_id;
    if (!connectionId) return;
    // Revoke the CRM connection here, e.g. DELETE /connections/{connectionId}.
    console.log(`Revoking CRM connection ${connectionId}`);
  },
};
