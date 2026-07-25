import type { Context, ServiceDescription, Setting } from "@orchestration-ai/sdk/services";
import type { Client } from "@orchestration-ai/sdk/app-builder";
import { loadSettings, boolSetting } from "../oai-files/oai-files.description.ts";
import {
  WORKSPACE_READ_KEY, WORKSPACE_WRITE_KEY,
  ORCHESTRATION_READ_KEY, ORCHESTRATION_WRITE_KEY,
} from "../oai-files/oai-files.constants.ts";

const METHOD_PARAM = {
  type: "string" as const,
  optional: true,
  description: "HTTP method. Defaults to GET. One of: GET, POST, PUT, PATCH, DELETE.",
};

const HEADERS_PARAM = {
  type: "object" as const,
  optional: true,
  description: "Optional request headers as key-value pairs.",
  properties: {},
};

const BODY_PARAM = {
  type: "string" as const,
  optional: true,
  description: "Optional request body as a string.",
};

function scopeDescription(canOrch: boolean, canWorkspace: boolean): string {
  const scopes = ["layer", "agent", ...(canOrch ? ["orchestration"] : []), ...(canWorkspace ? ["workspace"] : [])];
  return `Storage scope for the file. One of: ${scopes.join(", ")}.`;
}

export async function getInternetDescription(
  context: Context,
  _engineClient: Client,
  apiClient: Client,
): Promise<ServiceDescription> {
  const settings: Setting[] = await loadSettings(context, apiClient);
  const canWorkspaceRead = boolSetting(settings, WORKSPACE_READ_KEY);
  const canWorkspaceWrite = boolSetting(settings, WORKSPACE_WRITE_KEY);
  const canOrchRead = boolSetting(settings, ORCHESTRATION_READ_KEY);
  const canOrchWrite = boolSetting(settings, ORCHESTRATION_WRITE_KEY);

  return [
    // ── request ───────────────────────────────────────────────────────────────
    {
      path: "request",
      method: "POST",
      description:
        "Part of OAI Internet. Makes an HTTP request to any URL and returns the response status and body as text. " +
        "Response body is capped at 5 MB - use download_to_file for larger responses.",
      parameters: {
        url: { type: "string", optional: false, description: "The URL to request." },
        method: METHOD_PARAM,
        headers: HEADERS_PARAM,
        body: BODY_PARAM,
      },
    },

    // ── download_to_file ──────────────────────────────────────────────────────
    {
      path: "download_to_file",
      method: "POST",
      description:
        "Part of OAI Internet. Fetches a URL and saves the response body directly into OAI storage at the given scope and path. " +
        "Supports up to 100 MB. Use this instead of request when the response is a file or large payload.",
      parameters: {
        url: { type: "string", optional: false, description: "The URL to download from." },
        method: METHOD_PARAM,
        headers: HEADERS_PARAM,
        body: BODY_PARAM,
        scope: { type: "string", optional: false, description: scopeDescription(canOrchWrite, canWorkspaceWrite) },
        path: { type: "string", optional: false, description: "Destination file path in OAI storage (e.g. 'downloads/report.pdf')." },
      },
    },

    // ── request_with_file_body ────────────────────────────────────────────────
    {
      path: "request_with_file_body",
      method: "POST",
      description:
        "Part of OAI Internet. Makes an HTTP request using the contents of an OAI file as the request body. " +
        "Useful for uploading files to external APIs or services.",
      parameters: {
        url: { type: "string", optional: false, description: "The URL to send the request to." },
        method: { type: "string", optional: false, description: "HTTP method. One of: POST, PUT, PATCH." },
        headers: HEADERS_PARAM,
        scope: { type: "string", optional: false, description: scopeDescription(canOrchRead, canWorkspaceRead) },
        path: { type: "string", optional: false, description: "Path of the OAI file to use as the request body." },
        content_type: { type: "string", optional: true, description: "Content-Type header to send. Defaults to the file's stored content type." },
      },
    },
  ];
}
