// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFingerprint, MIN_SAMPLE_WORDS, MATTR_WINDOW, type Fingerprint } from "../fingerprint";
import { tokenize } from "../tokenize";
import { APPROVED_REFERENCE_DISTRIBUTIONS, rankDistinctiveMarkers, standardize, type ReferenceDistribution } from "../distinctiveness";

const m = (fp: Fingerprint, name: string) => {
  const x = fp.metrics.find((y) => y.name === name);
  if (!x) throw new Error(`missing metric ${name}`);
  return x;
};

// Deterministic sample builder (no randomness).
const PARA_A =
  "I've spent six years building data tools, and I don't think I've ever enjoyed a problem more than this one. We shipped a well-known pipeline in 2021; it cut latency by 38% (and saved the team 1,200 hours). Honestly, I'm proud of it. But it wasn't perfect.";
const PARA_B =
  "My manager asked a simple question: why does the nightly job fail? I didn't know. So I read the logs, talked to the on-call engineer, and found a race condition in the retry logic. Fixing it took two days.";
const long = (n: number) => {
  const parts: string[] = [];
  let i = 0;
  while (computeFingerprint(parts.join("\n\n")).wordCount < n) parts.push(i++ % 2 ? PARA_B : PARA_A);
  return parts.join("\n\n");
};
const S300 = long(MIN_SAMPLE_WORDS);
const S900 = long(900);

describe("edge inputs", () => {
  it.each([["empty", ""], ["whitespace", "   \n\n\t  "]])("%s sample: zero counts, all rates insufficient (null, not 0)", (_n, txt) => {
    const fp = computeFingerprint(txt);
    expect(fp.wordCount).toBe(0);
    expect(fp.sufficient).toBe(false);
    expect(m(fp, "word_count").value).toBe(0);
    for (const x of fp.metrics.filter((y) => y.unit !== "count")) {
      expect(x.value).toBeNull();
      expect(x.reliability).not.toBe("reliable");
    }
  });
  it("does not crash on odd input", () => {
    for (const s of ["!!!???...", "—", "   a  ", "\u200b\u00a0", "😀 😀", "a".repeat(5000), "1 2 3", "--- - -", "’’’", undefined as unknown as string]) {
      expect(() => computeFingerprint(s)).not.toThrow();
    }
  });
  it("short sample: exact counts reported, every other metric insufficient with value null but observed kept", () => {
    const fp = computeFingerprint(PARA_A);
    expect(fp.sufficient).toBe(false);
    expect(fp.wordCount).toBeGreaterThan(0);
    const c = m(fp, "contraction_rate");
    expect(c.reliability).toBe("insufficient_data");
    expect(c.value).toBeNull();
    expect(c.observed).toBeGreaterThan(0);
    expect(fp.reliableMetrics.sort()).toEqual(["paragraph_count", "sentence_count", "unique_word_count", "word_count"]);
  });
  it("~300-word sample is sufficient; rates become reliable", () => {
    const fp = computeFingerprint(S300);
    expect(fp.wordCount).toBeGreaterThanOrEqual(300);
    expect(fp.wordCount).toBeLessThan(360);
    expect(fp.sufficient).toBe(true);
    expect(m(fp, "contraction_rate").reliability).toBe("reliable");
    expect(m(fp, "mattr_50").value).not.toBeNull();
  });
  it("299 words is not sufficient (spec 300-word gate)", () => {
    const w = Array.from({ length: 299 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(" ");
    expect(computeFingerprint(w).sufficient).toBe(false);
    expect(computeFingerprint(w + " end").sufficient).toBe(true);
  });
  it("longer sample works and rate metrics are length-normalised", () => {
    const a = computeFingerprint(S300), b = computeFingerprint(S900);
    expect(b.wordCount).toBeGreaterThan(800);
    expect(Math.abs(m(a, "comma_rate").value! - m(b, "comma_rate").value!)).toBeLessThan(1);
    // uncertainty narrows with more words
    expect(m(b, "contraction_rate").uncertainty95!).toBeLessThan(m(a, "contraction_rate").uncertainty95!);
  });
});

describe("tokenizer", () => {
  it("contractions and hyphenated words are single words; hyphens are not dashes", () => {
    const t = tokenize("I don’t like well-known re-runs. It's fine - really — honestly – ok.");
    expect(t.words.map((w) => w.text)).toEqual(["I", "don’t", "like", "well-known", "re-runs", "It's", "fine", "really", "honestly", "ok"]);
    const fp = computeFingerprint(long(300) + "\n\nA well-known, state-of-the-art, re-run.");
    const base = computeFingerprint(long(300));
    expect(m(fp, "em_dash_rate").numerator).toBe(m(base, "em_dash_rate").numerator);
    expect(m(fp, "spaced_hyphen_rate").numerator).toBe(m(base, "spaced_hyphen_rate").numerator);
    expect(m(fp, "hyphenated_word_rate").numerator).toBe(m(base, "hyphenated_word_rate").numerator! + 3);
  });
  it("em dash, en dash and spaced hyphen counted separately", () => {
    const fp = computeFingerprint("One — two – three - four—five.");
    expect(m(fp, "em_dash_rate").numerator).toBe(2);
    expect(m(fp, "en_dash_rate").numerator).toBe(1);
    expect(m(fp, "spaced_hyphen_rate").numerator).toBe(1);
  });
  it("numbers, URLs and emails are not words, and their dots are not periods", () => {
    const t = tokenize("Cut 38% in 2021, saved 1,200 hours and 3.5 days. See https://ex.com/a.b or me@site.io today.");
    expect(t.tokens.filter((x) => x.type === "number").map((x) => x.text)).toEqual(["38%", "2021", "1,200", "3.5"]);
    expect(t.tokens.filter((x) => x.type === "url").map((x) => x.text)).toEqual(["https://ex.com/a.b"]);
    expect(t.tokens.filter((x) => x.type === "email").map((x) => x.text)).toEqual(["me@site.io"]);
    const fp = computeFingerprint("Cut 38% in 2021, saved 1,200 hours and 3.5 days. See https://ex.com/a.b or me@site.io today.");
    expect(m(fp, "period_rate").numerator).toBe(2);
    expect(m(fp, "numeric_token_rate").numerator).toBe(4);
  });
  it("quotes, parentheses and accented words", () => {
    const fp = computeFingerprint("She said “voilà, it's déjà vu” (really) and 'fine' [ok].");
    expect(tokenize("voilà déjà Zoë naïve café").words).toHaveLength(5);
    expect(m(fp, "quotation_mark_rate").numerator).toBe(4);
    expect(m(fp, "parenthesis_rate").numerator).toBe(2);
    expect(m(fp, "apostrophe_rate").numerator).toBe(1);
  });
  it("sentences, repeated punctuation, abbreviations, line breaks", () => {
    const t = tokenize("Really?! Yes... Dr. Smith agreed, e.g. twice.  Then   we left\nfor home.");
    expect(t.sentences.map((s) => s.words.length)).toEqual([1, 1, 5, 5]);
    expect(t.sentences[0].terminal).toBe("?!");
  });
  it("paragraphs and bullets", () => {
    const txt = "Intro line here.\n\nWhat I did:\n- Built the API\n• Cut costs 20%\n1. Led hiring\n\nClosing words.";
    const fp = computeFingerprint(txt);
    expect(m(fp, "paragraph_count").value).toBe(3);
    expect(m(fp, "bullet_line_rate").numerator).toBe(3);
    expect(m(fp, "bullet_line_rate").denominator).toBe(6);
    expect(m(fp, "spaced_hyphen_rate").numerator).toBe(0); // bullet marker is not punctuation
    expect(fp.counts.sentences).toBe(6);
  });
});

describe("metric categories (sufficient sample)", () => {
  const fp = computeFingerprint(S900);
  it("lexical", () => {
    expect(m(fp, "word_count").value).toBe(fp.wordCount);
    expect(m(fp, "unique_word_count").value).toBeLessThan(fp.wordCount);
    expect(m(fp, "mattr_50").value!).toBeGreaterThan(0);
    expect(m(fp, "mattr_50").value!).toBeLessThanOrEqual(1);
    const bins = ["word_length_1_3_share", "word_length_4_6_share", "word_length_7_9_share", "word_length_10_plus_share"].map((n) => m(fp, n).numerator!);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(fp.wordCount);
    expect(m(fp, "function_word_rate").numerator! + m(fp, "content_word_ratio").numerator!).toBe(fp.wordCount);
    expect(m(fp, "avg_word_length").value!).toBeGreaterThan(2);
  });
  it("repeated words lower diversity", () => {
    const rep = computeFingerprint(Array(320).fill("data").join(" "));
    expect(m(rep, "mattr_50").value).toBe(1 / MATTR_WINDOW);
    expect(m(rep, "unique_word_count").value).toBe(1);
  });
  it("sentence", () => {
    expect(m(fp, "avg_sentence_length").value).toBeCloseTo(fp.wordCount / fp.counts.sentences, 3);
    expect(m(fp, "question_sentence_rate").numerator).toBeGreaterThan(0);
    expect(m(fp, "i_start_rate").numerator).toBeGreaterThan(0);
    expect(m(fp, "conjunction_start_rate").numerator).toBeGreaterThan(0);
  });
  it("voice / contractions / first person", () => {
    const fp1 = computeFingerprint(long(300));
    const formal = computeFingerprint(long(300).replace(/I've/g, "The team has").replace(/I'm/g, "The team is").replace(/\bI\b/g, "The engineer").replace(/don't|didn't|wasn't/g, "did not").replace(/\b[Mm]y\b/g, "the"));
    expect(m(fp1, "contraction_rate").value!).toBeGreaterThan(m(formal, "contraction_rate").value!);
    expect(m(fp1, "first_person_rate").value!).toBeGreaterThan(m(formal, "first_person_rate").value!);
    expect(m(fp1, "first_person_share_of_pronouns").value!).toBeGreaterThan(0);
    expect(m(computeFingerprint("You know you're right, your call. " .repeat(60)), "second_person_rate").value!).toBeGreaterThan(20);
  });
  it("punctuation-heavy writing raises punctuation density", () => {
    const heavy = computeFingerprint(long(300).replace(/\./g, "!!").replace(/ and /g, "; and, "));
    expect(m(heavy, "punctuation_density").value!).toBeGreaterThan(m(computeFingerprint(long(300)), "punctuation_density").value!);
    expect(m(heavy, "semicolon_rate").value!).toBeGreaterThan(0);
  });
  it("function-word categories and discourse", () => {
    for (const n of ["article_rate", "determiner_rate", "conjunction_rate", "preposition_rate", "auxiliary_verb_rate", "pronoun_rate", "connective_rate", "negation_rate"]) {
      expect(m(fp, n).value!).toBeGreaterThan(0);
    }
    expect(m(fp, "discourse_marker_rate").numerator).toBeGreaterThan(0); // "Honestly", "So"
  });
  it("formatting", () => {
    expect(m(fp, "paragraph_count").value).toBeGreaterThan(3);
    expect(m(fp, "paragraph_length_sd").reliability).toBe("reliable");
    expect(m(computeFingerprint(long(300).replace(/\n\n/g, " ")), "paragraph_length_sd").reliability).toBe("not_applicable");
    expect(m(fp, "all_caps_word_rate").value).toBe(0); // real measured zero on a sufficient sample
  });
});

describe("definitions, reliability, determinism", () => {
  const fp = computeFingerprint(S300);
  it("implements 40+ metrics with full metadata and unique names", () => {
    expect(fp.metrics.length).toBeGreaterThanOrEqual(40);
    expect(new Set(fp.metrics.map((x) => x.name)).size).toBe(fp.metrics.length);
    for (const x of fp.metrics) {
      expect(x.name).toMatch(/^[a-z0-9_]+$/);
      expect(x.label && x.definition && x.unit && x.category && x.reliability).toBeTruthy();
    }
    expect(new Set(fp.metrics.map((x) => x.category))).toEqual(new Set(["lexical", "sentence", "voice", "punctuation", "function_words", "discourse", "formatting"]));
  });
  it("length-sensitive / spread metrics are never headline eligible (spec items 1–2)", () => {
    for (const n of ["raw_type_token_ratio", "hapax_ratio", "sentence_length_sd", "sentence_length_cv", "word_length_sd", "paragraph_length_sd", "sentence_opening_diversity"]) {
      expect(m(fp, n).headlineEligible).toBe(false);
    }
    expect(m(fp, "mattr_50").headlineEligible).toBe(true);
  });
  it("identical input → identical fingerprint; different input → different", () => {
    expect(computeFingerprint(S300)).toEqual(computeFingerprint(S300));
    expect(JSON.stringify(computeFingerprint(S900))).not.toBe(JSON.stringify(fp));
  });
  it("raw input is never altered by measurement", () => {
    const s = "  Don’t   change — me.\r\n\r\nPlease ";
    expect(tokenize(s).text).toBe(s);
  });
});

describe("distinctiveness interface (no baseline)", () => {
  const fp = computeFingerprint(S900);
  it("ships with no reference data — nothing fabricated", () => {
    expect(APPROVED_REFERENCE_DISTRIBUTIONS).toEqual([]);
    expect(rankDistinctiveMarkers(fp)).toEqual([]);
  });
  it("unapproved references are ignored", () => {
    const refs: ReferenceDistribution[] = [{ metric: "contraction_rate", method: "z_score", mean: 1, sd: 1, source: "test", approved: false }];
    expect(rankDistinctiveMarkers(fp, refs)).toEqual([]);
  });
  it("z-score and empirical percentile, ranked most distinctive first, deterministic", () => {
    const c = m(fp, "contraction_rate").value!, a = m(fp, "article_rate").value!;
    const refs: ReferenceDistribution[] = [
      { metric: "contraction_rate", method: "z_score", mean: c - 3, sd: 1, source: "test", approved: true },
      { metric: "article_rate", method: "z_score", mean: a + 1, sd: 1, source: "test", approved: true },
      { metric: "sentence_length_sd", method: "z_score", mean: 0, sd: 0.1, source: "test", approved: true }, // not headline
      { metric: "comma_rate", method: "empirical_percentile", values: [0, 0, 0, 0], source: "test", approved: true },
    ];
    const r = rankDistinctiveMarkers(fp, refs);
    expect(r.map((x) => x.metric)).toEqual(["contraction_rate", "article_rate", "comma_rate"]);
    expect(r[0].z).toBeCloseTo(3, 6);
    expect(r[1].direction).toBe("below");
    expect(r[2].percentile).toBe(100);
    expect(rankDistinctiveMarkers(fp, refs, { minDistance: 2 }).map((x) => x.metric)).toEqual(["contraction_rate"]);
  });
  it("insufficient metrics are never standardised", () => {
    const short = computeFingerprint(PARA_A);
    expect(standardize(m(short, "contraction_rate"), { metric: "contraction_rate", method: "z_score", mean: 0, sd: 1, source: "t", approved: true })).toBeNull();
  });
  it("ranking accepts only the writing-sample fingerprint (no answer parameter)", () => {
    expect(rankDistinctiveMarkers.length).toBeLessThanOrEqual(3);
  });
});

describe("privacy / isolation", () => {
  afterEach(() => vi.restoreAllMocks());
  it("no network, no AI, no logging", () => {
    const f = vi.spyOn(globalThis, "fetch");
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    computeFingerprint("SECRET-SAMPLE " + S300);
    expect(f).not.toHaveBeenCalled();
    for (const l of logs) expect(l).not.toHaveBeenCalled();
  });
  it("engine source imports nothing external (no providers, db, network)", () => {
    for (const f of ["fingerprint.ts", "tokenize.ts", "lexicon.ts", "distinctiveness.ts"]) {
      const src = readFileSync(join(process.cwd(), "src/lib/stylometry", f), "utf8");
      expect(src).not.toMatch(/fetch\(|anthropic|openai|supabase|console\.|process\.env/i);
      for (const imp of src.match(/from\s+"([^"]+)"/g) ?? []) expect(imp).toMatch(/"\.\/(tokenize|lexicon|fingerprint)"/);
    }
  });
  it("fast enough for a demo request", () => {
    const t0 = performance.now();
    computeFingerprint(long(3000));
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
