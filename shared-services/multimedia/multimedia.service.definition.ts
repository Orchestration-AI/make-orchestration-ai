import { defineService } from "@orchestration-ai/sdk/app-builder";
import { multimediaDescription } from "./multimedia.description.ts";
import { readFile } from "./multimedia.service.ts";

export const multimediaService = defineService({
  unique_name: "multimedia",
  service_name: "OAI Multimedia",
  service_description: "Convert files from URLs into readable markdown text. Supports PDF, Word, Excel, HTML, CSV, XML, ZIP, images, Jupyter notebooks, and YouTube transcripts.",
  description: multimediaDescription,
  tools: {
    read_file: (body: { url: string; file_type?: string }) => readFile(body),
  },
});
