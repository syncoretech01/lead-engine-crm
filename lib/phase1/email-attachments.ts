import type { EmailAttachment } from "@/lib/providers/adapters/amazon-ses";

export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB across all files

// Allowed by extension — browser-reported MIME types are unreliable, and this
// keeps executables/scripts out. Common outreach/business document types.
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "rtf", "md", "zip"
]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  md: "text/markdown",
  zip: "application/zip"
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Read, validate, and base64-encode the "attachments" entries from a submitted
 * FormData. Throws (surfaced to the user) on any policy violation. Returns [] if
 * no files were attached.
 */
export async function readEmailAttachments(entries: FormDataEntryValue[]): Promise<EmailAttachment[]> {
  const files = entries.filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) {
    return [];
  }
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`You can attach at most ${MAX_ATTACHMENTS} files.`);
  }

  let totalBytes = 0;
  const attachments: EmailAttachment[] = [];
  for (const file of files) {
    const ext = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`"${file.name}" is not an allowed attachment type.`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(`Attachments exceed the ${Math.round(MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024))} MB total limit.`);
    }
    const content = Buffer.from(await file.arrayBuffer()).toString("base64");
    attachments.push({
      filename: file.name,
      contentType: file.type || CONTENT_TYPE_BY_EXT[ext] || "application/octet-stream",
      content
    });
  }
  return attachments;
}
