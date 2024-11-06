// @deno-types=npm:@types/showdown@2.0.6
import showdown from "showdown";
import { Setting } from "../types.ts";
import { getBooleanSetting, getTextSetting } from "../utils.ts";
import {
  smtpHostSettingKey,
  smtpPortSettingKey,
  smtpUserSettingKey,
  smtpPasswordSettingKey,
  smtpSecureSettingKey,
  smtpSelfEmailSettingKey,
} from "./mail.constants.ts";
import { getRequiredEnvValue } from "../environment.ts";

function getMailerTransport(settings: Setting[]) {
  const smtpHost = getTextSetting(settings, smtpHostSettingKey);
  const smtpPort = parseInt(
    getTextSetting(settings, smtpPortSettingKey)?.trim() ?? "25"
  );
  const smtpUser = getTextSetting(settings, smtpUserSettingKey);
  const smtpPassword = getTextSetting(settings, smtpPasswordSettingKey);
  const smtpSecure = getBooleanSetting(settings, smtpSecureSettingKey);

  return {
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  };
}

async function sendMail(
  htmlContent: string,
  textContent: string,
  to: string,
  subject: string,
  transport: unknown,
  settings: Setting[]
) {
  const smtpFrom = getTextSetting(settings, smtpSelfEmailSettingKey);
  const body = {
    transport,
    message: {
      from: smtpFrom,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    },
  };

  const accessKey = getRequiredEnvValue("OAI_ACCESS_KEY");
  const mailProxyUrl = getRequiredEnvValue("MAIL_PROXY_URL");

  return (
    await fetch(mailProxyUrl, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${accessKey}`,
        "Content-Type": "application/json",
      },
    })
  ).text();
}

export function sendMarkdownMail(
  markdown: string,
  to: string,
  subject: string,
  settings: Setting[]
) {
  const converter = new showdown.Converter();
  const html = converter.makeHtml(markdown);
  const transport = getMailerTransport(settings);

  return sendMail(html, markdown, to, subject, transport, settings);
}
