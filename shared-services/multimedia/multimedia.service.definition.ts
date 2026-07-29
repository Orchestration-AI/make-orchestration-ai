import { defineServiceWithDynamicDescription } from "@orchestration-ai/sdk/app-builder";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import type { Setting } from "@orchestration-ai/sdk/services";
import { getTextSetting } from "@orchestration-ai/sdk/services";
import { settingFindByAgent } from "@orchestration-ai/sdk/sdk.gen";
import { multimediaDescription } from "./multimedia.description.ts";
import { readFile } from "./multimedia.service.ts";
import { defaultSettings, bodyMaxCharsSettingKey } from "./multimedia.constants.ts";

export const multimediaService = defineServiceWithDynamicDescription({
  unique_name: "multimedia",
  service_name: "OAI Multimedia",
  service_description: "Convert files from URLs into readable markdown text. Supports PDF, Word, Excel, HTML, CSV, XML, ZIP, images, Jupyter notebooks, and YouTube transcripts.",
  defaultSettings,
  description: () => Promise.resolve(multimediaDescription),
  tools: {
    read_file: async (
      body: { url: string; file_type?: string },
      context: Context,
      _engineClient: Client,
      apiClient: Client,
    ) => {
      const { data } = await settingFindByAgent({
        client: apiClient,
        path: {
          workspaceId: context.identity.workspaceId,
          orchestrationId: context.identity.orchestrationId,
          agentId: context.identity.agentId,
        },
      });
      const settings = (data?.settings ?? []) as Setting[];
      const bodyMaxChars = +(getTextSetting(settings, bodyMaxCharsSettingKey) ?? 20 * 1024) || 20 * 1024;
      return readFile({ ...body, bodyMaxChars });
    },
  },
});
