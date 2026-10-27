// Sales Copilot installer entrypoint.
//
// Serves the landing page + install wizard. Uses its own OAuth client.
//
//   npm install
//   npx tsx install.ts
//
// Required env:
//   INSTALLER_OAUTH_CLIENT_ID, INSTALLER_OAUTH_CLIENT_SECRET,
//   INSTALLER_OAUTH_REDIRECT_URI (e.g. http://localhost:3002/install)

import { createInstaller } from "@orchestration-ai/sdk/installer";
import { salesCopilotInstaller } from "./sales-copilot.installer";

const installer = createInstaller(salesCopilotInstaller, {
  oauthClientId: process.env.INSTALLER_OAUTH_CLIENT_ID,
  oauthClientSecret: process.env.INSTALLER_OAUTH_CLIENT_SECRET,
  oauthRedirectUri: process.env.INSTALLER_OAUTH_REDIRECT_URI,
});

installer.listen(process.env.PORT || 3002);
