import type { ServiceDescription } from "@orchestration-ai/sdk/services";

export const multimediaDescription: ServiceDescription = [
  {
    path: "read_file",
    method: "POST",
    description:
      "Part of OAI Multimedia. Downloads a file from the given URL and returns its contents as markdown text. " +
      "Supported formats: PDF, Word (.docx), Excel (.xlsx), HTML, plain text, CSV, XML, RSS, Atom, " +
      "Jupyter Notebooks (.ipynb), ZIP archives (contents processed recursively), " +
      "images (EXIF metadata extracted), YouTube URLs (transcript extracted). " +
      "PowerPoint (.pptx), audio transcription, and SharePoint/Outlook formats are not supported. " +
      "Works with OAI Files signed download URLs and any publicly accessible URL. " +
      "Maximum file size is 100 MB by default.",
    parameters: {
      url: {
        type: "string",
        optional: false,
        description: "The URL of the file to read. Can be an OAI Files signed download URL or any accessible URL.",
      },
      file_type: {
        type: "string",
        optional: true,
        description: "File extension hint (e.g. '.pdf', '.docx') used only when the file type cannot be determined from the URL path or Content-Type header.",
      },
    },
  },
];
