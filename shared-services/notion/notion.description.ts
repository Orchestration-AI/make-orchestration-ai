import type { ServiceDescription, ServiceDescriptionPart } from "@orchestration-ai/sdk/services";
import { NOTION_TOOL_TABLE } from "./notion.tools.ts";

const scopeParam = {
  type: "enum" as const,
  optional: false,
  description: "OAI storage scope of the file.",
  options: ["layer", "agent", "orchestration", "workspace"],
};

// OAI <-> Notion file bridge tools (not part of the generic SDK dispatch table).
const bridgeTools: ServiceDescriptionPart[] = [
  {
    path: "upload_oai_file_to_notion",
    method: "POST",
    description:
      "Part of OAI Notion. Reads a file from OAI storage and uploads it to Notion. Returns a file_upload_id you can attach to a page, block, or 'files' property by passing { type: 'file_upload', id: <file_upload_id> } in a later pages_update or blocks_children_append call.",
    parameters: {
      scope: scopeParam,
      path: { type: "string", optional: false, description: "Path of the OAI file to upload (e.g. 'reports/q3.pdf')." },
      filename: { type: "string", optional: true, description: "Filename to register in Notion. Defaults to the basename of path." },
      content_type: { type: "string", optional: true, description: "MIME type. Defaults to the file's stored content type." },
    },
  },
  {
    path: "download_notion_file_to_oai",
    method: "POST",
    description:
      "Part of OAI Notion. Downloads a Notion-hosted or external file URL (as returned in block/property responses) and saves it into OAI storage. Notion file URLs are pre-signed and expire, so call this soon after retrieving the URL.",
    parameters: {
      file_url: { type: "string", optional: false, description: "The Notion file URL to download (from a block or property response)." },
      scope: scopeParam,
      path: { type: "string", optional: false, description: "Destination path in OAI storage (e.g. 'notion/attachment.pdf')." },
      content_type: { type: "string", optional: true, description: "MIME type override. Defaults to the fetched content type." },
    },
  },
];

/** ServiceDescription generated from the declarative tool table + file bridge tools. */
export const notionServiceDescription: ServiceDescription = [
  ...NOTION_TOOL_TABLE.map((entry): ServiceDescriptionPart => ({
    path: entry.tool,
    method: "POST",
    description: entry.description,
    parameters: entry.parameters,
  })),
  ...bridgeTools,
];
