/**
 * Resume parsing abstraction.
 * For Milestone 1 we extract text best-effort.
 * - PDF: we extract any embedded plain-text segments and fall back to file name only.
 * - DOCX / TXT: extract directly.
 * Future milestones can swap implementations (pdfjs, mammoth) without changing call sites.
 */

export interface ParsedResume {
  text: string;
  charCount: number;
}

async function parseTextFile(file: File): Promise<string> {
  return await file.text();
}

async function parsePdfText(file: File): Promise<string> {
  // Best-effort: pull printable ASCII strings from the raw bytes.
  // Good enough for scoring heuristics in M1.
  const buf = new Uint8Array(await file.arrayBuffer());
  let out = "";
  let current = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ((c >= 32 && c <= 126) || c === 10 || c === 13) {
      current += String.fromCharCode(c);
    } else {
      if (current.length >= 4) out += current + " ";
      current = "";
    }
  }
  if (current.length >= 4) out += current;
  return out;
}

export async function parseResume(file: File): Promise<ParsedResume> {
  const name = file.name.toLowerCase();
  let text = "";
  try {
    if (name.endsWith(".pdf")) {
      text = await parsePdfText(file);
    } else if (name.endsWith(".docx") || name.endsWith(".doc")) {
      // Fallback to ASCII strings extraction for DOCX in M1.
      text = await parsePdfText(file);
    } else {
      text = await parseTextFile(file);
    }
  } catch {
    text = "";
  }
  return { text, charCount: text.length };
}
