/**
 * Smart Application Field Intelligence — classification, recall, learning
 * and the safety rules that decide what Aplyer may write into a form.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  isSensitiveQuestion,
  looksLikeYesNoQuestion,
  mayAutofill,
  normalizeQuestion,
  normalizeYesNo,
} from "../field-types";
import { matchQuestion, similarity, MEDIUM_THRESHOLD } from "../question-match";
import {
  resolveFieldAnswers,
  saveFieldAnswer,
  normalizeFieldQueries,
  sanitizeOptions,
  FieldMemoryError,
} from "../field-memory.server";

/* ---------------- in-memory Supabase double ---------------- */

type Row = Record<string, any>;

function makeDb(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  const api = {
    rows,
    from() {
      const filters: Array<[string, any]> = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => (filters.push([c, v]), q),
        in: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: rows.filter((r) => filters.every(([c, v]) => r[c] === v)) }),
        maybeSingle: () =>
          Promise.resolve({ data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null }),
        update: () => ({ eq: () => ({ in: () => Promise.resolve({}) , eq: () => Promise.resolve({}) }) }),
        upsert: (row: Row) => {
          const i = rows.findIndex(
            (r) =>
              r.user_id === row.user_id &&
              r.question_hash === row.question_hash &&
              r.field_type === row.field_type,
          );
          if (i >= 0) rows[i] = { ...rows[i], ...row };
          else rows.push({ id: `r${rows.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return api;
}

const USER = "u-1";

/* ---------------- classification ---------------- */

describe("field classification", () => {
  it("recognises yes/no phrasing", () => {
    expect(looksLikeYesNoQuestion("Are you legally authorized to work in the US?")).toBe(true);
    expect(looksLikeYesNoQuestion("Will you now or in the future require sponsorship?")).toBe(true);
    expect(looksLikeYesNoQuestion("Describe a project you are proud of.")).toBe(false);
  });

  it("normalizes yes/no values", () => {
    expect(normalizeYesNo("YES")).toBe("Yes");
    expect(normalizeYesNo(" no ")).toBe("No");
    expect(normalizeYesNo("maybe")).toBeNull();
  });

  it("normalizes question text stably", () => {
    expect(normalizeQuestion("  Do you REQUIRE sponsorship?? ")).toBe("do you require sponsorship");
  });

  it("treats identity and financial questions as sensitive", () => {
    for (const q of [
      "Password",
      "Social Security Number",
      "Enter your passport number",
      "Bank account number",
      "Date of birth",
      "What are your salary expectations?",
    ]) {
      expect(isSensitiveQuestion(q)).toBe(true);
    }
    expect(isSensitiveQuestion("Do you require visa sponsorship?")).toBe(false);
  });

  it("only allows autofill at HIGH and MEDIUM confidence", () => {
    expect(mayAutofill("HIGH")).toBe(true);
    expect(mayAutofill("MEDIUM")).toBe(true);
    expect(mayAutofill("LOW")).toBe(false);
  });
});

/* ---------------- question matching ---------------- */

describe("question matching", () => {
  const candidates = [
    {
      questionHash: "h1",
      normalizedQuestion: normalizeQuestion("Will you now or in the future require visa sponsorship?"),
      questionText: "Will you now or in the future require visa sponsorship?",
    },
  ];

  it("matches identical questions at HIGH confidence", () => {
    const r = matchQuestion("Will you now or in the future require visa sponsorship?", candidates);
    expect(r.confidence).toBe("HIGH");
    expect(r.match?.questionHash).toBe("h1");
  });

  it("matches a reworded question at MEDIUM confidence", () => {
    const r = matchQuestion("Do you require sponsorship for a visa?", candidates);
    expect(r.similarity).toBeGreaterThanOrEqual(MEDIUM_THRESHOLD);
    expect(r.confidence).toBe("MEDIUM");
  });

  it("refuses to match an unrelated question", () => {
    const r = matchQuestion("How many years of Python experience do you have?", candidates);
    expect(r.match).toBeNull();
    expect(r.confidence).toBe("LOW");
  });

  it("similarity is symmetric and bounded", () => {
    const a = "Do you require sponsorship?";
    const b = "Will you require visa sponsorship?";
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 10);
    expect(similarity(a, a)).toBe(1);
  });
});

/* ---------------- recall + autofill decisions ---------------- */

describe("field recall", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb([
      {
        id: "r1",
        user_id: USER,
        question_hash: "h-sponsor",
        normalized_question: normalizeQuestion("Do you require visa sponsorship?"),
        question_text: "Do you require visa sponsorship?",
        field_type: "YES_NO",
        answer_value: "No",
        options_snapshot: ["Yes", "No"],
        confirmed_by_user: true,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "r2",
        user_id: USER,
        question_hash: "h-gender",
        normalized_question: normalizeQuestion("Gender"),
        question_text: "Gender",
        field_type: "DROPDOWN",
        answer_value: "Prefer not to say",
        options_snapshot: ["Male", "Female", "Prefer not to say"],
        confirmed_by_user: true,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("fills a previously answered yes/no question", async () => {
    const [d] = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f1", questionText: "Do you require visa sponsorship?", fieldType: "YES_NO", options: ["Yes", "No"] },
    ]);
    expect(d.action).toBe("FILL");
    expect(d.value).toBe("No");
    expect(d.confidence).toBe("HIGH");
  });

  it("fills a reworded yes/no question at MEDIUM confidence", async () => {
    const [d] = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f1", questionText: "Will you require sponsorship for a visa?", fieldType: "YES_NO", options: ["Yes", "No"] },
    ]);
    expect(d.action).toBe("FILL");
    expect(d.confidence).toBe("MEDIUM");
  });

  it("recalls a dropdown selection that is still offered", async () => {
    const [d] = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f2", questionText: "Gender", fieldType: "DROPDOWN", options: ["Male", "Female", "Prefer not to say"] },
    ]);
    expect(d.action).toBe("FILL");
    expect(d.value).toBe("Prefer not to say");
  });

  it("asks instead of guessing when the saved option disappeared", async () => {
    const [d] = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f2", questionText: "Gender", fieldType: "DROPDOWN", options: ["Male", "Female"] },
    ]);
    expect(d.action).toBe("ASK");
    expect(d.reason).toBe("saved_value_not_available");
  });

  it("asks when there is no memory at all", async () => {
    const [d] = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f3", questionText: "How did you hear about us?", fieldType: "DROPDOWN", options: ["LinkedIn"] },
    ]);
    expect(d.action).toBe("ASK");
    expect(d.reason).toBe("no_memory");
  });

  it("never touches sensitive or file fields", async () => {
    const ds = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f4", questionText: "Social Security Number", fieldType: "TEXT" },
      { fieldId: "f5", questionText: "Upload your resume", fieldType: "FILE" },
    ]);
    expect(ds.map((d) => d.action)).toEqual(["SKIP", "SKIP"]);
    expect(ds[0]!.reason).toBe("sensitive_field");
  });

  it("never crosses field types", async () => {
    const [d] = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f6", questionText: "Do you require visa sponsorship?", fieldType: "DROPDOWN", options: ["Yes", "No"] },
    ]);
    expect(d.action).toBe("ASK");
  });

  it("never returns another user's memory", async () => {
    const [d] = await resolveFieldAnswers(db as never, "other-user", [
      { fieldId: "f1", questionText: "Do you require visa sponsorship?", fieldType: "YES_NO", options: ["Yes", "No"] },
    ]);
    expect(d.action).toBe("ASK");
  });
});

/* ---------------- learning from corrections ---------------- */

describe("learning", () => {
  it("saves a user answer and recalls it next time", async () => {
    const db = makeDb();
    await saveFieldAnswer(db as never, USER, {
      questionText: "Are you willing to relocate?",
      fieldType: "YES_NO",
      answerValue: "yes",
      options: ["Yes", "No"],
    });
    const [d] = await resolveFieldAnswers(db as never, USER, [
      { fieldId: "f1", questionText: "Are you willing to relocate?", fieldType: "YES_NO", options: ["Yes", "No"] },
    ]);
    expect(d.action).toBe("FILL");
    expect(d.value).toBe("Yes");
  });

  it("a correction replaces the earlier answer", async () => {
    const db = makeDb();
    const input = { questionText: "Are you willing to relocate?", fieldType: "YES_NO" as const, options: ["Yes", "No"] };
    await saveFieldAnswer(db as never, USER, { ...input, answerValue: "Yes" });
    await saveFieldAnswer(db as never, USER, { ...input, answerValue: "No", source: "correction" });
    expect(db.rows).toHaveLength(1);
    const [d] = await resolveFieldAnswers(db as never, USER, [{ fieldId: "f1", ...input }]);
    expect(d.value).toBe("No");
  });

  it("an unconfirmed suggestion never overwrites a confirmed correction", async () => {
    const db = makeDb();
    const input = { questionText: "Are you willing to relocate?", fieldType: "YES_NO" as const };
    await saveFieldAnswer(db as never, USER, { ...input, answerValue: "No", confirmedByUser: true });
    await saveFieldAnswer(db as never, USER, {
      ...input,
      answerValue: "Yes",
      source: "suggestion",
      confirmedByUser: false,
    });
    expect(db.rows[0]!.answer_value).toBe("No");
  });

  it("refuses to remember sensitive answers", async () => {
    const db = makeDb();
    await expect(
      saveFieldAnswer(db as never, USER, {
        questionText: "Social Security Number",
        fieldType: "TEXT",
        answerValue: "123-45-6789",
      }),
    ).rejects.toBeInstanceOf(FieldMemoryError);
    expect(db.rows).toHaveLength(0);
  });

  it("refuses an unparseable yes/no answer", async () => {
    const db = makeDb();
    await expect(
      saveFieldAnswer(db as never, USER, {
        questionText: "Are you willing to relocate?",
        fieldType: "YES_NO",
        answerValue: "possibly",
      }),
    ).rejects.toBeInstanceOf(FieldMemoryError);
  });
});

/* ---------------- request hardening ---------------- */

describe("request hardening", () => {
  it("drops malformed fields and caps the batch", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      fieldId: `f${i}`,
      questionText: "Are you willing to relocate?",
      fieldType: "YES_NO",
    }));
    expect(normalizeFieldQueries(many).length).toBeLessThanOrEqual(60);
    expect(normalizeFieldQueries([{ fieldId: "", questionText: "x" }, null, 5])).toEqual([]);
  });

  it("coerces an unknown field type instead of trusting it", () => {
    const [q] = normalizeFieldQueries([
      { fieldId: "f", questionText: "Anything", fieldType: "EVAL" },
    ]);
    expect(q!.fieldType).toBe("UNKNOWN");
  });

  it("caps and cleans option lists", () => {
    expect(sanitizeOptions(["  a  ", "", null, "b"])).toEqual(["a", "b"]);
    expect(sanitizeOptions(Array.from({ length: 500 }, (_, i) => `o${i}`))).toHaveLength(60);
    expect(sanitizeOptions("not-an-array")).toEqual([]);
  });
});
