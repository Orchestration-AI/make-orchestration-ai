import { Setting } from "../types.ts";

export const smtpHostSettingKey = "SMTP_HOST";
export const smtpPortSettingKey = "SMTP_PORT";
export const smtpUserSettingKey = "SMTP_USER";
export const smtpPasswordSettingKey = "SMTP_PASSWORD";
export const smtpSecureSettingKey = "SMTP_SECURE";
export const smtpSelfEmailSettingKey = "SMTP_SELF_EMAIL";
export const autoSendSettingKey = "AUTO_SEND";

export const defaultSettings: Setting[] = [
  {
    setting_name: smtpHostSettingKey,
    setting_description: "The SMTP_HOST to use for sending emails.",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: smtpPortSettingKey,
    setting_description: "The SMTP_PORT to use for sending emails. Defaults to 25.",
    setting_type: "Text",
    text_value: "25",
  },
  {
    setting_name: smtpUserSettingKey,
    setting_description: "The SMTP_USER to use for sending emails.",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: smtpPasswordSettingKey,
    setting_description: "The SMTP_PASSWORD to use for sending emails.",
    setting_type: "Text",
    text_value: "",
  },
  {
    setting_name: smtpSecureSettingKey,
    setting_description: "Whether or not to use SSL for the SMTP connection.",
    setting_type: "Boolean",
    boolean_value: true,
  },
  {
    setting_name: smtpSelfEmailSettingKey,
    setting_description: "The SMTP_EMAIL to use when sending emails. This is the email address of the agent.",
    setting_type: "Text",
    text_value: '',
  },
  {
    setting_name: autoSendSettingKey,
    setting_description:
      "When true, the agent will be able to autonomously send emails. When false, the agent can only reply to emails.",
    setting_type: "Boolean",
    boolean_value: false,
  },  
];
