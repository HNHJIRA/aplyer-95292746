/**
 * Canonical resume text extraction.
 *
 * ONE implementation, shared by the dashboard upload, the extension upload and
 * the server-side repair path. PDF goes through pdf.js (via unpdf), DOCX through
 * a zip read of word/document.xml, everything else is treated as plain text.
 */
import { unzipSync, strFromU8 } from "fflate";

/** Text that is really an undecoded binary container (old naive extraction). */
export function looksLikeBinaryResumeText(text: string): boolean {
  if (!text) return true;
  const head = text.slice(0, 4000);
  if (/^\s*%PDF-/.test(head)) return true;
  if (head.includes("/Type /Page") || head.includes("endobj") || head.includes("stream\n")) return true;
  if (head.startsWith("PK\u0003\u0004")) return true;
  return false;
}

function cleanup(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

function extractDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const parts = ["word/document.xml", "word/header1.xml", "word/footer1.xml"]
    .filter((p) => files[p])
    .map((p) => strFromU8(files[p]!));
  if (!parts.length) return "";
  return parts
    .join("\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function extractResumeText(bytes: Uint8Array, fileName = ""): Promise<string> {
  const name = fileName.toLowerCase();
  const isPdf = name.endsWith(".pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  try {
    if (isPdf) return cleanup(await extractPdf(bytes));
    if (name.endsWith(".docx") || isZip) return cleanup(extractDocx(bytes));
    return cleanup(strFromU8(bytes));
  } catch {
    return "";
  }
}
