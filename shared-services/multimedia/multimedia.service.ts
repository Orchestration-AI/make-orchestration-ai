// @deno-types="npm:markitdown-ts@0.0.10"
import { MarkItDown } from "markitdown-ts";
import { Buffer } from "node:buffer";
import process from "node:process";

const MAX_FILE_SIZE_BYTES = +(process.env.MULTIMEDIA_MAX_FILE_SIZE_BYTES || 104857600);

const markitdown = new MarkItDown();

export async function readFile(body: { url: string; file_type?: string }): Promise<{ markdown: string; truncated?: boolean; note?: string }> {
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

  const MARKDOWN_LIMIT = +(process.env.MAIL_BODY_MAX_CHARS || 20 * 1024);
  if (result.markdown.length > MARKDOWN_LIMIT) {
    return {
      markdown: result.markdown.slice(0, MARKDOWN_LIMIT),
      truncated: true,
      note: `Content was truncated to ${MARKDOWN_LIMIT} characters. The full file contains approximately ${result.markdown.length} characters.`,
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
