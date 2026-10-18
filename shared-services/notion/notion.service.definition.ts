import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import { NOTION_SERVICE_UNIQUE_NAME, defaultSettings } from "./notion.constants.ts";
import { notionServiceDescription } from "./notion.description.ts";
import { buildNotionTools } from "./notion.service.ts";

export const notionService = defineServiceWithDynamicDescription({
  unique_name: NOTION_SERVICE_UNIQUE_NAME,
  service_name: "OAI Notion",
  service_description:
    "Read and write Notion pages, databases, data sources, blocks, comments, and views via the official Notion SDK, plus bridge files between OAI storage and Notion.",
  defaultSettings,
  // Static description, but served through the dynamic hook so the generated
  // tool table (whose keys aren't statically known to defineService) type-checks.
  description: () => notionServiceDescription,
  tools: buildNotionTools(),
});
