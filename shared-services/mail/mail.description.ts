import { ServiceDescription, type Context } from "../types.ts";
import { getBooleanSetting } from "../utils.ts";
import { autoSendSettingKey } from "./mail.constants.ts";

export function getDescriptionForContext(context: Context): ServiceDescription {
  const autoSend = getBooleanSetting(context.settings, autoSendSettingKey);
  if (autoSend) {
    return [
      {
        path: "send_email",
        method: "POST",
        description:
          "Part of OAI E-Mail Service. Sends an email to a given email address.",
        parameters: {
          body: {
            type: "string",
            optional: false,
            description: "The e-mail body to send, in markdown.",
          },
          subject: {
            type: "string",
            optional: false,
            description: "The subject for the email.",
          },
          to: {
            type: "string",
            optional: false,
            description:
              "Comma separated list of recipients email addresses that will appear on the To: field",
          },
          cc: {
            type: "string",
            optional: true,
            description:
              "Comma separated list of recipients email addresses that will appear on the Cc: field",
          },
          bcc: {
            type: "string",
            optional: true,
            description:
              "Comma separated list of recipients email addresses that will appear on the Bcc: field",
          },
        },
      },
    ];
  } else {
    return [];
  }
}
