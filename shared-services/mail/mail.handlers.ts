import { getContext } from "../context.middleware.ts";
import { createApiClient } from "@orchestration-ai/sdk/services";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import { authDecryptPasskey, settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { getRequiredEnvValue } from "../environment.ts";
import { getImapCredentials } from "./imap.proxy.ts";
import { getMailerTransport } from "./mail.service.ts";
import type { Setting } from "@orchestration-ai/sdk/services";
import { getTextSetting, getBooleanSetting } from "@orchestration-ai/sdk/services";
import {
  smtpHostSettingKey, smtpPortSettingKey, smtpUserSettingKey,
  smtpSecureSettingKey, smtpSelfEmailSettingKey,
  imapHostSettingKey, imapPortSettingKey, imapUserSettingKey, imapSecureSettingKey,
} from "./mail.constants.ts";
// @deno-types="npm:@types/express@5.0.0"
import type { Request, Response } from "express";

function makeApiClient(workspaceOwnerId: string) {
  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const clientId = getRequiredEnvValue("OAI_CLIENT_ID");
  const apiClient = createApiClient();
  setupClientCredentials(apiClient, {
    client_secret: accessKey,
    client_id: `${clientId}:${workspaceOwnerId}`,
  });
  return apiClient;
}

// GET /services/mail/config/api/init
export async function handleMailConfigInit(req: Request, res: Response): Promise<void> {
  try {
    const passkey = req.query.passkey as string;
    if (!passkey) { res.status(400).send("Missing passkey"); return; }

    const anonClient = createApiClient();
    const { data: decrypted } = await authDecryptPasskey({ body: { passkey }, client: anonClient });
    const layerId = decrypted?.data as string;
    if (!layerId) { res.status(401).send("Invalid passkey"); return; }

    const context = await getContext(layerId);
    const apiClient = makeApiClient(context.identity.workspaceOwnerId);
    const { data } = await settingFindByAgent({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
    });
    const settings = data!.settings! as Setting[];
    console.log(settings);
    res.json({
      layerId: context.identity.layerId,
      settings: {
        smtpHost: getTextSetting(settings, smtpHostSettingKey) ?? "",
        smtpPort: getTextSetting(settings, smtpPortSettingKey) ?? "",
        smtpUser: getTextSetting(settings, smtpUserSettingKey) ?? "",
        smtpSecure: getBooleanSetting(settings, smtpSecureSettingKey) ?? true,
        smtpFrom: getTextSetting(settings, smtpSelfEmailSettingKey) ?? "",
        imapHost: getTextSetting(settings, imapHostSettingKey) ?? "",
        imapPort: getTextSetting(settings, imapPortSettingKey) ?? "",
        imapUser: getTextSetting(settings, imapUserSettingKey) ?? "",
        imapSecure: getBooleanSetting(settings, imapSecureSettingKey) ?? true,
      },
    });
  } catch (err) {
    console.warn("[mail:config] Init error:", err);
    res.status(500).send("Init failed");
  }
}

// POST /services/mail/config/api/test-smtp
export async function handleMailTestSmtp(req: Request, res: Response): Promise<void> {
  const layerId = req.headers["x-layer-id"] as string;
  if (!layerId) { res.status(401).send("Missing x-layer-id"); return; }

  try {
    const context = await getContext(layerId);
    const apiClient = makeApiClient(context.identity.workspaceOwnerId);
    const { data } = await settingFindByAgent({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
    });

    const transport = getMailerTransport(data!.settings! as Setting[]);
    const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
    const mailProxyUrl = getRequiredEnvValue("MAIL_PROXY_URL");
    const smtpFrom = getTextSetting(data!.settings! as Setting[], smtpSelfEmailSettingKey) ?? "";

    const testBody = {
      transport,
      message: {
        from: smtpFrom,
        to: smtpFrom,
        subject: "OAI Mail - SMTP Test",
        text: "SMTP connection test successful.",
        html: "<p>SMTP connection test successful.</p>",
      },
    };

    const proxyRes = await fetch(mailProxyUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(testBody),
    });

    if (!proxyRes.ok) {
      const err = await proxyRes.text();
      res.status(500).json({ success: false, error: err });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.warn("[mail:config] SMTP test error:", err);
    res.status(500).json({ success: false, error: `${err}` });
  }
}

// POST /services/mail/config/api/test-imap
export async function handleMailTestImap(req: Request, res: Response): Promise<void> {
  const layerId = req.headers["x-layer-id"] as string;
  if (!layerId) { res.status(401).send("Missing x-layer-id"); return; }

  try {
    const context = await getContext(layerId);
    const apiClient = makeApiClient(context.identity.workspaceOwnerId);
    const { data } = await settingFindByAgent({
      client: apiClient,
      path: {
        workspaceId: context.identity.workspaceId,
        orchestrationId: context.identity.orchestrationId,
        agentId: context.identity.agentId,
      },
    });

    const credentials = getImapCredentials(data!.settings! as Setting[]);
    if (!credentials) { res.status(400).json({ success: false, error: "IMAP settings are not configured." }); return; }

    const imapProxyUrl = getRequiredEnvValue("IMAP_PROXY_URL");
    const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");

    const proxyRes = await fetch(imapProxyUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "FETCH_LIST", credentials, filters: { limit: 1 } }),
    });

    if (!proxyRes.ok) {
      const err = await proxyRes.text();
      res.status(500).json({ success: false, error: err });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.warn("[mail:config] IMAP test error:", err);
    res.status(500).json({ success: false, error: `${err}` });
  }
}
