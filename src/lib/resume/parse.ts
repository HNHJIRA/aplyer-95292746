/**
 * Resume parsing abstraction (single canonical implementation).
 * PDF -> pdf.js text layer, DOCX -> document.xml, TXT -> raw text.
 */
import { extractResumeText } from "./extract";

export interface ParsedResume {
  text: string;
  charCount: number;
}

export async function parseResume(file: File): Promise<ParsedResume> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await extractResumeText(bytes, file.name);
  return { text, charCount: text.length };
}
