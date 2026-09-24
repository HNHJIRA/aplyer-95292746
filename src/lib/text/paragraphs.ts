/**
 * Presentation-only paragraph breaking for long generated prose.
 *
 * Never rewrites, summarises or drops text: the output paragraphs, joined
 * with a single space, equal the input with only its whitespace between
 * sentences normalised. Existing blank-line paragraph breaks are kept.
 */

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "inc", "ltd", "co", "corp",
  "e.g", "i.e", "approx", "dept", "est", "no", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
  "sep", "sept", "oct", "nov", "dec", "u.s", "u.k", "a.m", "p.m", "ph.d", "m.s", "b.s", "b.a", "m.b.a",
]);

/** Splits one block into sentences at . ! ? followed by whitespace + a capital/quote/digit. */
export function splitSentences(text: string): string[] {
  const src = text.replace(/\s+/g, " ").trim();
  if (!src) return [];
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]+["')\]]*\s+(?=["'(\[]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = m.index + m[0].trimEnd().length;
    const before = src.slice(start, m.index + 1);
    const lastWord = (before.match(/(\S+)$/)?.[1] ?? "").replace(/^[("'[]+/, "");
    const bare = lastWord.replace(/[.!?]+$/, "").toLowerCase();
    // Initials ("W.W.", "J."), known abbreviations: not a sentence end.
    if (src[m.index] === "." && (/^(?:[A-Za-z]\.)*[A-Za-z]$/.test(bare) || ABBREVIATIONS.has(bare))) continue;
    out.push(src.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  const rest = src.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Breaks prose into readable paragraphs of about 3-4 sentences. Blocks that
 * already have 4 or fewer sentences are left whole; no single-sentence tail
 * paragraph is created when it can join the previous one.
 */
export function toReadableParagraphs(text: string, perParagraph = 3): string[] {
  const blocks = String(text ?? "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const block of blocks) {
    const sentences = splitSentences(block);
    if (sentences.length <= perParagraph + 1) {
      out.push(sentences.join(" "));
      continue;
    }
    const groups: string[][] = [];
    for (let i = 0; i < sentences.length; i += perParagraph) groups.push(sentences.slice(i, i + perParagraph));
    const last = groups[groups.length - 1]!;
    if (groups.length > 1 && last.length === 1) {
      groups[groups.length - 2]!.push(...last);
      groups.pop();
    }
    for (const g of groups) out.push(g.join(" "));
  }
  return out;
}
