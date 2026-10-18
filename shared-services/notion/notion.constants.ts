import type { Setting } from "@orchestration-ai/sdk/services";
import process from "node:process";

export const NOTION_SERVICE_UNIQUE_NAME = "notion";

/** Agent-scoped secret holding the Notion integration token (internal integration or OAuth access token). */
export const NOTION_API_KEY = "NOTION_API_KEY";

/**
 * Notion API version sent by the client. The v5 SDK defaults to "2025-09-03"
 * (the data-source model). Override via env if Notion ships a newer version.
 */
export const NOTION_VERSION = process.env.NOTION_API_VERSION || "2025-09-03";

/**
 * Max bytes for file bridging between OAI storage and Notion file uploads.
 * Notion single-part uploads are capped at 20 MB; we default to that.
 */
export const MAX_FILE_BYTES = +(process.env.NOTION_MAX_FILE_BYTES || 20_971_520);

export const defaultSettings: Setting[] = [
  {
    setting_name: NOTION_API_KEY,
    setting_description:
      "Notion integration token used to authenticate API calls. Create an internal integration at https://www.notion.so/my-integrations and paste its secret here, then share the relevant pages/databases with the integration.",
    setting_type: "Secret",
    text_value: "",
  },
];
