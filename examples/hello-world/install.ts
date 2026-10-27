// Hello World installer entrypoint.
//
// Serves the public landing page + install wizard. Each installer uses its own
// OAuth client; set the env vars below before running.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInstaller } from "@orchestration-ai/sdk/installer";
import { helloWorldInstaller } from "./hello-world.installer";

const here = dirname(fileURLToPath(import.meta.url));

const installer = createInstaller(helloWorldInstaller, {
  // These come from the OAuth application you registered for THIS installer.
  oauthClientId: process.env.INSTALLER_OAUTH_CLIENT_ID,
  oauthClientSecret: process.env.INSTALLER_OAUTH_CLIENT_SECRET,
  oauthRedirectUri: process.env.INSTALLER_OAUTH_REDIRECT_URI, // e.g. https://install.example.com/install
  // Serves ./assets at /assets (used for the installer logo).
  assetsDir: join(here, "assets"),
  // apiBaseUrl: "https://api.orchestration-ai.com", // override for staging
  // basePath: "",                                   // set if mounted under a path
});

installer.listen(process.env.PORT || 3002);
