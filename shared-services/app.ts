import { createApp } from "@orchestration-ai/sdk/app-builder";
import type { Setting } from "@orchestration-ai/sdk/services";
import { createEngineClient, createApiClient } from "@orchestration-ai/sdk/services";
import { settingFindByAgent, taskCreate } from "@orchestration-ai/sdk/sdk.gen";
import { setupClientCredentials } from "@orchestration-ai/sdk/oauth-utils";
import process from "node:process";
import { handleStreamingChatInit, sendMessageToAgent } from "./voice/voice.service.ts";
import { messagingService } from "./messages/messaging.service.definition.ts";
import { voiceService } from "./voice/voice.service.definition.ts";
import { sqlServerService } from "./sql-server/sql-server.service.definition.ts";
import { mailService } from "./mail/mail.service.definition.ts";
import { webhookService } from "./webhook/webhook.service.definition.ts";
import { mathjsService } from "./mathjs/mathjs.service.definition.ts";
import { telnyxVoiceService } from "./telnyx-voice/telnyx-voice.service.definition.ts";
import { oaiFilesService } from "./oai-files/oai-files.service.definition.ts";
import { multimediaService } from "./multimedia/multimedia.service.definition.ts";
import { internetService } from "./internet/internet.service.definition.ts";
import { timeService } from "./time/time.service.definition.ts";
import { oaiSandboxService } from "./oai-sandbox/oai-sandbox.service.definition.ts";
import { registerQueueListener } from "./oai-sandbox/oai-sandbox.service.ts";
import { handleJobDone, handleConfigInit, handleConfigSave, handleJobsList, handleJobCancel, handleJobOutput, handleJobStop, handleResetCounter } from "./oai-sandbox/oai-sandbox.handlers.ts";
import "./oai-sandbox/oai-sandbox.crons.ts";
import { handleTelnyxWebhook } from "./telnyx-voice/telnyx-voice.service.ts";
import { sendMarkdownMail } from "./mail/mail.service.ts";
import { getContext } from "./context.middleware.ts";
import { getRequiredEnvValue } from "./environment.ts";
import { asyncWebhookProcessingSettingKey } from "./webhook/webhook.constants.ts";
// @deno-types="npm:@types/express@5.0.0"
import express from "express";

const PORT = process.env.PORT || 3001;

const app = createApp()
  .permissions([
    {
      permission_name: "role_agent_reader",
      justification: "Read agent context and send messages to agents within the orchestration.",
    },
    {
      permission_name: "role_agent_writer",
      justification: "Register and update agent endpoints and links.",
    },
    {
      permission_name: "role_task_inserter",
      justification: "Submit ticker tasks to other agents for async inter-agent messaging.",
    },
    {
      permission_name: "role_storage_workspace_writer",
      justification: "Read and write files across all storage scopes on behalf of agents.",
    },
  ])
  .service(messagingService)
  .service(voiceService)
  .service(sqlServerService)
  .service(mailService)
  .service(webhookService)
  .service(mathjsService)
  .service(telnyxVoiceService)
  .service(oaiFilesService)
  .service(multimediaService)
  .service(internetService)
  .service(timeService)
  .service(oaiSandboxService);

// Custom: mail zapier webhook (receives emails from Zapier)
app.expressApp.post(
  "/services/mail/api/zapier/:layerId",
  async (req, res) => {
    try {
      const context = await getContext(req.params.layerId);
      const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
      const engineClient = createEngineClient(process.env.ENGINE_URL ?? null, accessKey);
      const apiClient = createApiClient();
      setupClientCredentials(apiClient, {
        client_id: accessKey,
        client_secret: `${accessKey}:${context.identity.workspaceOwnerId}`,
      });

      const sessionId = req.headers['x-session-id'] as string | undefined;
      const { body: markdownBody, from, cc, bcc, subject } = req.body;

      let message = `New e-mail from ${from}\nSubject: ${subject}\n`;
      if (cc) message += `Cc: ${cc}\n`;
      if (bcc) message += `Bcc: ${bcc}\n`;

      const agentResponse = await sendMessageToAgent(
        `${message}\n${markdownBody}`,
        context,
        engineClient,
        sessionId
      );

      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });

      const response = await sendMarkdownMail(
        agentResponse,
        from,
        cc,
        bcc,
        `RE: ${subject}`,
        data!.settings! as Setting[]
      );

      res.status(200).send(response);
    } catch (e) {
      console.warn(e);
      res.status(500).send(`${e}`);
    }
  }
);

// Custom: webhook event endpoint
app.expressApp.post(
  "/services/webhook/api/event/:layerId",
  async (req, res) => {
    try {
      const context = await getContext(req.params.layerId);
      const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
      const apiClient = createApiClient();
      setupClientCredentials(apiClient, {
        client_id: accessKey,
        client_secret: `${accessKey}:${context.identity.workspaceOwnerId}`,
      });

      const body = JSON.stringify(req.body);
      const headersText = Object.entries(req.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
      const message = `New Webhook event\n\nHeaders:${headersText}\n\nJSON Body:\n${body}\n`;

      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });

      const asyncSetting = (data!.settings! as Setting[]).find(
        (s) => s.setting_name === asyncWebhookProcessingSettingKey
      );
      const isAsync = asyncSetting?.setting_type === "Boolean" && asyncSetting.boolean_value;

      if (isAsync) {
        await taskCreate({
          client: apiClient,
          path: {
            workspaceId: context.identity.workspaceId,
            orchestrationId: context.identity.orchestrationId,
            agentId: context.identity.agentId,
          },
          body: { message },
        });
        res.send("MESSAGE_RECEIVED");
      } else {
        const engineClient = createEngineClient(process.env.ENGINE_URL ?? null, accessKey);
        const sessionId = req.headers['x-session-id'] as string | undefined;
        const agentResponse = await sendMessageToAgent(message, context, engineClient, sessionId);
        res.send(agentResponse);
      }
    } catch (e) {
      console.warn(e);
      res.status(500).send(`${e}`);
    }
  }
);

// Custom: telnyx voice webhook
app.expressApp.post(
  "/services/telnyx-voice/api/webhook/:layerId",
  handleTelnyxWebhook
);

// Streaming chat init endpoints (must be before static middleware)
app.expressApp.get("/services/telnyx-voice/call/api/init", handleStreamingChatInit);
app.expressApp.get("/services/voice/chat/api/init", handleStreamingChatInit);

// Custom: telnyx voice call page
app.expressApp.use(
  "/services/telnyx-voice/call",
  express.static("./telnyx-voice/public")
);

// Custom: serve voice chat static files
app.expressApp.use(
  "/services/voice/chat",
  express.static("./voice/public")
);

// OAI Sandbox: job-done webhook
app.expressApp.post(
  "/services/oai-sandbox/api/job-done/:layerId/:jobId",
  handleJobDone
);

// OAI Sandbox: env-var config UI init + save
app.expressApp.get("/services/oai-sandbox/config/api/init", handleConfigInit);
app.expressApp.post("/services/oai-sandbox/config/api/save", handleConfigSave);

// OAI Sandbox: internal admin
app.expressApp.post("/services/oai-sandbox/internal/reset-counter", handleResetCounter);

// OAI Sandbox: job control APIs
app.expressApp.get("/services/oai-sandbox/config/api/jobs", handleJobsList);
app.expressApp.post("/services/oai-sandbox/config/api/jobs/:jobId/cancel", handleJobCancel);
app.expressApp.get("/services/oai-sandbox/config/api/jobs/:jobId/output", handleJobOutput);
app.expressApp.post("/services/oai-sandbox/config/api/jobs/:jobId/stop", handleJobStop);

// OAI Sandbox: serve config UI static files
app.expressApp.use(
  "/services/oai-sandbox/config",
  express.static("./oai-sandbox/public")
);

// Register sandbox queue listener
registerQueueListener();

app.listen(PORT);
