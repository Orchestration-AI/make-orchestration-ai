// @deno-types="npm:markitdown-ts@0.0.10"
import { MarkItDown } from "markitdown-ts";
import { Buffer } from "node:buffer";
import process from "node:process";
import * as mupdf from "mupdf";
import { PNG } from "pngjs";
import type { Context, Client } from "@orchestration-ai/sdk/app-builder";
import { storageUploadFileAgent } from "@orchestration-ai/sdk/sdk.gen";
import { putToSignedUrl } from "../oai-files/oai-files.service.ts";

const MAX_FILE_SIZE_BYTES = +(process.env.MULTIMEDIA_MAX_FILE_SIZE_BYTES || 104857600);

const markitdown = new MarkItDown();

export async function readFile(body: { url: string; file_type?: string; bodyMaxChars?: number }): Promise<{ markdown: string; truncated?: boolean; note?: string }> {
  const { url } = body;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  // Check Content-Length header first to fast-fail before downloading
  const contentLength = response.headers.get("content-length");
  if (contentLength && +contentLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File size ${contentLength} bytes exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes.`
    );
  }

  // Stream bytes with a running counter to enforce limit even without Content-Length
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Unable to read response body.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_FILE_SIZE_BYTES) {
      await reader.cancel();
      throw new Error(
        `File exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes. Download aborted.`
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const buffer = Buffer.from(merged);

  // Derive file extension from URL path or Content-Type for the buffer converter
  const urlPath = new URL(url).pathname;
  const extMatch = urlPath.match(/(\.[a-zA-Z0-9]+)(?:\?|$)/);
  const contentType = response.headers.get("content-type") ?? "";
  const fileExtension = extMatch?.[1] ?? contentTypeToExtension(contentType) ?? body.file_type ?? ".bin";

  const result = await markitdown.convertBuffer(buffer, { file_extension: fileExtension });

  if (!result) throw new Error("markitdown-ts returned no result for the given file.");

  const BODY_LIMIT = body.bodyMaxChars ?? (20 * 1024);
  if (result.markdown.length > BODY_LIMIT) {
    return {
      markdown: result.markdown.slice(0, BODY_LIMIT),
      truncated: true,
      note: `Content was truncated to ${BODY_LIMIT} characters. The full file contains approximately ${result.markdown.length} characters.`,
    };
  }

  return { markdown: result.markdown };
}

function contentTypeToExtension(contentType: string): string | undefined {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/html": ".html",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "application/zip": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/json": ".json",
  };
  const base = contentType.split(";")[0].trim();
  return map[base];
}

export async function pdfToImage(
  body: { url: string },
  context: Context,
  _engineClient: Client,
  apiClient: Client,
): Promise<{ file_name: string }> {
  const response = await fetch(body.url);
  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
  const pdfBytes = new Uint8Array(await response.arrayBuffer());

  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const pageCount = doc.countPages();
  const scale = 2;

  // Render each page to PNG and decode into raw RGBA
  const pages: { width: number; height: number; data: Buffer }[] = [];
  let totalWidth = 0;
  let totalHeight = 0;

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    const png = PNG.sync.read(Buffer.from(pixmap.asPNG()));
    pages.push({ width: png.width, height: png.height, data: png.data });
    totalWidth = Math.max(totalWidth, png.width);
    totalHeight += png.height;
    pixmap.destroy();
  }

  // Stitch all pages into one tall PNG
  const combined = new PNG({ width: totalWidth, height: totalHeight });
  let yOffset = 0;
  for (const page of pages) {
    for (let row = 0; row < page.height; row++) {
      const srcStart = row * page.width * 4;
      const dstStart = (yOffset + row) * totalWidth * 4;
      page.data.copy(combined.data, dstStart, srcStart, srcStart + page.width * 4);
    }
    yOffset += page.height;
  }

  const pngBuffer = PNG.sync.write(combined);
  const fileName = `.temp/${crypto.randomUUID()}.png`;

  const { workspaceId, orchestrationId, agentId } = context.identity;
  const { data } = await storageUploadFileAgent({
    client: apiClient,
    path: { workspaceId, orchestrationId, agentId },
    body: { path: fileName, content_type: "image/png" },
  });
  if (!data?.upload_url) throw new Error("Failed to get signed upload URL.");

  await putToSignedUrl(data.upload_url, new Uint8Array(pngBuffer), "image/png", data.max_size_bytes ?? 104857600);

  return { file_name: fileName };
}
