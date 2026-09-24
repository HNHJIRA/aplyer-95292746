/**
 * Deterministic tokenizer for the stylometric fingerprint. Pure, no I/O.
 *
 * The original text is never rewritten. Matching is done on a lowercased
 * copy of each word with curly apostrophes (’ ‘ ʼ) mapped to ' so "don’t"
 * and "don't" are the same word. Punctuation is counted on the ORIGINAL
 * text, so typographic choices (curly quotes, em dash, ellipsis) survive.
 *
 * Rules:
 * - Contractions ("don't", "we're", "Sam's") are ONE word token.
 * - Hyphenated words ("well-known", "re-run") are ONE word token. A hyphen
 *   inside a word is NOT punctuation and never an em dash.
 * - Em dash (U+2014), en dash (U+2013) and a spaced ASCII hyphen (" - ")
 *   are counted separately.
 * - Numbers ("38", "3.5", "1,200", "40%", "2021") are number tokens, not words.
 * - URLs and email addresses are single tokens of their own type, not words,
 *   and their dots/slashes/@ are not counted as punctuation.
 * - Accented / non-ASCII letters are letters (Unicode \p{L} + marks).
 * - Quoted text and parenthesised text are tokenized normally; the quote
 *   and bracket characters are counted as punctuation.
 * - Paragraphs are separated by one or more blank lines.
 * - A line starting with "-", "*", "•", "‣", "◦", "–" or "1." / "1)" is a
 *   bullet line; the marker is not counted as punctuation or as a word.
 * - Sentences end at . ! ? … (runs like "?!" or "..." count once) followed by
 *   whitespace/closing quote/end, at a line that is a bullet item, or at a
 *   paragraph break. Common abbreviations ("e.g.", "Mr.") do not end sentences.
 */

export type TokenType = "word" | "number" | "url" | "email";
export interface Token {
  type: TokenType;
  text: string; // exact original text
  norm: string; // lowercased, apostrophes unified (matching only)
}

export interface Sentence {
  words: Token[];
  /** The terminal punctuation run, or "" when ended by line/paragraph/end. */
  terminal: string;
}

export interface Tokenized {
  text: string; // exact input
  tokens: Token[];
  words: Token[];
  sentences: Sentence[];
  paragraphs: { words: number }[];
  lines: { text: string; bullet: boolean }[];
  /** Text with URLs, emails and bullet markers blanked, for punctuation counts. */
  punctuationText: string;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+[^\s<>()"'.,;:!?]/giu;
const EMAIL_RE = /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}\b/giu;
const BULLET_RE = /^\s*(?:[-*•‣◦–]|\d{1,3}[.)])\s+/u;
const APOS = /[’‘ʼ]/gu;
const WORD_PART = String.raw`\p{L}[\p{L}\p{M}]*(?:['’‘ʼ]\p{L}[\p{L}\p{M}]*)*`;
const TOKEN_RE = new RegExp(
  String.raw`(?<url>\u0000U\d+\u0000)|(?<email>\u0000E\d+\u0000)|(?<num>\p{N}+(?:[.,]\p{N}+)*%?)|(?<word>${WORD_PART}(?:-${WORD_PART})*)|(?<end>[.!?…]+)|(?<nl>\n)`,
  "gu",
);
const ABBREV = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "inc", "ltd", "co", "no", "approx", "dept"]);

export function normWord(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(APOS, "'");
}

export function tokenize(input: string): Tokenized {
  const text = typeof input === "string" ? input : "";
  const src = text.replace(/\r\n?/g, "\n");

  // Lines / bullets / paragraphs (from the original, markers removed later).
  const rawLines = src.split("\n");
  const lines = rawLines.filter((l) => l.trim()).map((l) => ({ text: l, bullet: BULLET_RE.test(l) }));

  // Placeholders keep URLs/emails as single tokens and out of punctuation counts.
  const urls: string[] = [];
  const emails: string[] = [];
  const masked = rawLines
    .map((l) => l.replace(BULLET_RE, (m) => " ".repeat(m.length) + "\u0001"))
    .join("\n")
    .replace(EMAIL_RE, (m) => `\u0000E${emails.push(m) - 1}\u0000`)
    .replace(URL_RE, (m) => `\u0000U${urls.push(m) - 1}\u0000`);
  const punctuationText = masked.replace(/\u0000[UE]\d+\u0000/g, " ").replace(/\u0001/g, "");

  const tokens: Token[] = [];
  const sentences: Sentence[] = [];
  const paragraphs: { words: number }[] = [];
  let cur: Token[] = [];
  let paraWords = 0;
  let blankRun = 0;

  const closeSentence = (terminal: string) => {
    if (cur.length) sentences.push({ words: cur, terminal });
    cur = [];
  };
  const closeParagraph = () => {
    closeSentence("");
    if (paraWords) paragraphs.push({ words: paraWords });
    paraWords = 0;
  };

  // Process line by line so bullet lines and blank lines are structural.
  const maskedLines = masked.split("\n");
  for (const line of maskedLines) {
    if (!line.replace(/\u0001/g, "").trim()) {
      blankRun++;
      if (blankRun === 1) closeParagraph();
      continue;
    }
    blankRun = 0;
    const isBullet = line.includes("\u0001");
    if (isBullet) closeSentence("");
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(line))) {
      const g = m.groups ?? {};
      if (g.url) {
        const t = urls[Number(g.url.slice(2, -1))] ?? "";
        tokens.push({ type: "url", text: t, norm: t.toLowerCase() });
      } else if (g.email) {
        const t = emails[Number(g.email.slice(2, -1))] ?? "";
        tokens.push({ type: "email", text: t, norm: t.toLowerCase() });
      } else if (g.num) {
        tokens.push({ type: "number", text: g.num, norm: g.num });
      } else if (g.word) {
        const tok: Token = { type: "word", text: g.word, norm: normWord(g.word) };
        tokens.push(tok);
        cur.push(tok);
        paraWords++;
      } else if (g.end) {
        const prev = cur[cur.length - 1];
        const next = line.slice(m.index + g.end.length);
        const isAbbrev = g.end === "." && prev && ABBREV.has(prev.norm) && !/^\s*$/.test(next) && !/^\s+\p{Lu}/u.test(next) === true;
        const boundary = /^(?:["'”’)\]]*)(?:\s|$)/u.test(next);
        if (boundary && !isAbbrev) closeSentence(g.end);
      }
    }
    if (isBullet) closeSentence("");
  }
  closeParagraph();

  return { text, tokens, words: tokens.filter((t) => t.type === "word"), sentences, paragraphs, lines, punctuationText };
}
