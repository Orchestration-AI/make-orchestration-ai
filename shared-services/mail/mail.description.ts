import { ServiceDescription } from "../types.ts";

export const mailDescription: ServiceDescription = [
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
        description: "The email address to send the email to.",
      },
    },
  },
];
