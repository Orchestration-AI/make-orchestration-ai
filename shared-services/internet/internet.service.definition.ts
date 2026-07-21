import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import { defaultSettings } from "../oai-files/oai-files.constants.ts";
import { getInternetDescription } from "./internet.description.ts";
import { request, downloadToFile, requestWithFileBody } from "./internet.service.ts";
import type { HttpMethod, Scope } from "./internet.service.ts";

export const internetService = defineServiceWithDynamicDescription({
  unique_name: "internet",
  service_name: "OAI Internet",
  service_description: "Make HTTP requests, scrape web content, and download files from the internet directly into OAI storage.",
  defaultSettings,
  description: getInternetDescription,
  tools: {
    request: (body: { url: string; method?: HttpMethod; headers?: Record<string, string>; body?: string }) =>
      request(body),
    download_to_file: (body: { url: string; method?: HttpMethod; headers?: Record<string, string>; body?: string; scope: Scope; path: string }, context, _e, apiClient) =>
      downloadToFile(body, context, _e, apiClient),
    request_with_file_body: (body: { url: string; method: HttpMethod; headers?: Record<string, string>; scope: Scope; path: string; content_type?: string }, context, _e, apiClient) =>
      requestWithFileBody(body, context, _e, apiClient),
  },
});
