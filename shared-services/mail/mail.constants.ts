import type { Setting } from "@orchestration-ai/sdk/services";

export const smtpHostSettingKey = "SMTP_HOST";
export const smtpPortSettingKey = "SMTP_PORT";
export const smtpUserSettingKey = "SMTP_USER";
export const smtpPasswordSettingKey = "SMTP_PASSWORD";
export const smtpSecureSettingKey = "SMTP_SECURE";
export const smtpSelfEmailSettingKey = "SMTP_SELF_EMAIL";
export const autoSendSettingKey = "AUTO_SEND";
export const bodyMaxCharsSettingKey = "BODY_MAX_CHARS";

export const imapHostSettingKey = "IMAP_HOST";
export const imapPortSettingKey = "IMAP_PORT";
export const imapUserSettingKey = "IMAP_USER";
export const imapPasswordSettingKey = "IMAP_PASSWORD";
export const imapSecureSettingKey = "IMAP_SECURE";

export const MAIL_SERVICE_UNIQUE_NAME = "mail";

export const defaultSettings: Setting[] = [
  {
    setting_name: smtpHostSettingKey,
    setting_description: "The SMTP host to use for sending emails.",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: smtpPortSettingKey,
    setting_description: "The SMTP port to use for sending emails. Defaults to 25.",
    setting_type: "Text",
    text_value: "25",
  },
  {
    setting_name: smtpUserSettingKey,
    setting_description: "The SMTP username to use for sending emails.",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: smtpPasswordSettingKey,
    setting_description: "The SMTP password to use for sending emails.",
    setting_type: "Secret",
    text_value: "",
  },
  {
    setting_name: smtpSecureSettingKey,
    setting_description: "Whether to use SSL for the SMTP connection.",
    setting_type: "Boolean",
    boolean_value: true,
  },
  {
    setting_name: smtpSelfEmailSettingKey,
    setting_description: "The email address of the agent (used as the From address).",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: bodyMaxCharsSettingKey,
    setting_description: "Maximum number of characters returned to the LLM per tool response. Keep this low to avoid filling the LLM context window.",
    setting_type: "Text",
    text_value: "20480",
  },
  {
    setting_name: autoSendSettingKey,
    setting_description:
      "When true, the agent can autonomously send emails. When false, the agent can only reply to emails.",
    setting_type: "Boolean",
    boolean_value: false,
  },
  {
    setting_name: imapHostSettingKey,
    setting_description: "The IMAP host to use for receiving emails.",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: imapPortSettingKey,
    setting_description: "The IMAP port to use for receiving emails. Defaults to 993.",
    setting_type: "Text",
    text_value: "993",
  },
  {
    setting_name: imapUserSettingKey,
    setting_description: "The IMAP username to use for receiving emails.",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: imapPasswordSettingKey,
    setting_description: "The IMAP password to use for receiving emails.",
    setting_type: "Secret",
    text_value: "",
  },
  {
    setting_name: imapSecureSettingKey,
    setting_description: "Whether to use TLS for the IMAP connection.",
    setting_type: "Boolean",
    boolean_value: true,
  },
];
