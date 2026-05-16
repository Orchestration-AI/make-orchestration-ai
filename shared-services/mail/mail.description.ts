import type { Context, ServiceDescription, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { getBooleanSetting } from "@orchestration-ai/sdk/services";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { autoSendSettingKey } from "./mail.constants.ts";

export async function getDescriptionForContext(context: Context, _engineClient: Client, apiClient: Client): Promise<ServiceDescription> {
  const { data } = await settingFindByAgent({
    client: apiClient,
    path: {
      workspaceId: context.identity.workspaceId,
      orchestrationId: context.identity.orchestrationId,
      agentId: context.identity.agentId,
    },
  });
  const autoSend = getBooleanSetting(data!.settings! as Setting[], autoSendSettingKey);
  if (autoSend) {
    return [
      {
        path: "send_email",
        method: "POST",
        description:
          "Part of OAI E-Mail Service. Sends an email to a given email address.",
        parameters: {
          body: { type: "string", optional: false, description: "The e-mail body to send, in markdown." },
          subject: { type: "string", optional: false, description: "The subject for the email." },
          to: { type: "string", optional: false, description: "Comma separated list of recipients email addresses that will appear on the To: field" },
          cc: { type: "string", optional: true, description: "Comma separated list of recipients email addresses that will appear on the Cc: field" },
          bcc: { type: "string", optional: true, description: "Comma separated list of recipients email addresses that will appear on the Bcc: field" },
        },
      },
    ];
  } else {
    return [];
  }
}
