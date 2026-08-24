import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FactInventoryError,
  computeSourceHash,
  ensureFactInventory,
  getFactInventoryState,
} from "@/lib/ai/fact-inventory.server";
import { PROMPT_P0_FACT_INVENTORY, FACT_INVENTORY_SCHEMA_VERSION } from "@/lib/ai/prompts/prompt-p0-fact-inventory";

const RESUME_TEXT = `Jane Doe
Berlin, Germany | jane@example.com

Experience
Company A — Software Engineer
2021 - 2022
Worked with React and Node.js.
Helped improve conversion on the signup funnel.

Company B — Senior Engineer
2023 - Present
Built an automated reporting pipeline that reduced weekly reporting time by 6 hours.`;

const GOOD_OUTPUT = {
  identity: { name: "Jane Doe", location: "Berlin, Germany" },
  contact: { email: "jane@example.com", phone: null, linkedin: null, portfolio: null },
  professionalSummaryFacts: [],
  experience: [
    {
      company: "Company A",
      role: "Software Engineer",
      location: null,
      startDate: "2021",
      endDate: "2022",
      isCurrent: false,
      facts: [
        {
          id: "",
          value: "Worked with React and Node.js",
          evidence: "Worked with React and Node.js.",
          sourceSection: "Experience — Company A (Software Engineer)",
          confidence: "explicit",
        },
      ],
      technologies: [],
      achievements: [],
    },
  ],
  education: [],
  skills: [],
  certifications: [],
  projects: [],
  achievements: [],
  otherFacts: [],
};

// ---- fake supabase ----

interface Row extends Record<string, unknown> {
  user_id: string;
  resume_id: string;
  schema_version: string;
  prompt_version: string;
  status: string;
}

class FakeDb {
  resumes: Array<{ id: string; user_id: string; resume_text: string; is_current: boolean; uploaded_at: string }> = [];
  inventories: Row[] = [];

  from(table: string) {
    return new Query(this, table);
  }
}

class Query {
  private filters: Array<[string, unknown]> = [];
  private payload: Record<string, unknown> | null = null;
  private mode: "select" | "update" | "upsert" = "select";

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  update(payload: Record<string, unknown>) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Record<string, unknown>) {
    this.mode = "upsert";
    this.payload = payload;
    return this;
  }

  private rows(): Record<string, unknown>[] {
    return this.table === "resumes"
      ? (this.db.resumes as unknown as Record<string, unknown>[])
      : (this.db.inventories as unknown as Record<string, unknown>[]);
  }

  private matched() {
    return this.rows().filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }

  async maybeSingle() {
    if (this.mode === "select") return { data: this.matched()[0] ?? null, error: null };
    if (this.mode === "update") {
      const hits = this.matched();
      hits.forEach((r) => Object.assign(r, this.payload));
      return { data: hits[0] ?? null, error: null };
    }
    // upsert on the composite unique key
    const p = this.payload as Row;
    const existing = this.db.inventories.find(
      (r) =>
        r.user_id === p.user_id &&
        r.resume_id === p.resume_id &&
        r.schema_version === p.schema_version &&
        r.prompt_version === p.prompt_version,
    );
    if (existing) {
      Object.assign(existing, p);
      return { data: existing, error: null };
    }
    this.db.inventories.push({ ...p });
    return { data: this.db.inventories[this.db.inventories.length - 1], error: null };
  }

  then(resolve: (v: { data: unknown; error: null }) => void) {
    return this.maybeSingle().then(resolve);
  }
}

function makeDb() {
  const db = new FakeDb();
  db.resumes.push({
    id: "resume-1",
    user_id: "user-a",
    resume_text: RESUME_TEXT,
    is_current: true,
    uploaded_at: new Date().toISOString(),
  });
  return db;
}

let aiCalls = 0;
const queued: Response[] = [];

function ok(obj: unknown) {
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(obj) }] }), { status: 200 });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  aiCalls = 0;
  queued.length = 0;
  vi.stubGlobal("fetch", async () => {
    aiCalls += 1;
    const next = queued.shift();
    if (!next) throw new Error("no queued AI response");
    return next;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("P0 extraction", () => {
  it("extracts a normal resume and stores a ready inventory", async () => {
    const db = makeDb();
    queued.push(ok(GOOD_OUTPUT));
    const state = await ensureFactInventory(db, "user-a");
    expect(state.status).toBe("ready");
    expect(state.model).toBe(PROMPT_P0_FACT_INVENTORY.model);
    expect(state.schemaVersion).toBe(FACT_INVENTORY_SCHEMA_VERSION);
    expect(state.factCount).toBe(1);
    expect(aiCalls).toBe(1);
  });

  it("is idempotent: identical resume + version makes zero extra AI calls", async () => {
    const db = makeDb();
    queued.push(ok(GOOD_OUTPUT));
    await ensureFactInventory(db, "user-a");
    const before = aiCalls;
    const again = await ensureFactInventory(db, "user-a");
    expect(again.status).toBe("ready");
    expect(aiCalls).toBe(before);
  });

  it("marks the inventory stale when the resume text changes", async () => {
    const db = makeDb();
    queued.push(ok(GOOD_OUTPUT));
    await ensureFactInventory(db, "user-a");
    db.resumes[0].resume_text = `${RESUME_TEXT}\nCompany C — Staff Engineer\n2025 - Present`;
    const state = await getFactInventoryState(db, "user-a");
    expect(state.status).toBe("stale");
  });

  it("retries once on malformed JSON and succeeds", async () => {
    const db = makeDb();
    queued.push(new Response(JSON.stringify({ content: [{ type: "text", text: "not json" }] }), { status: 200 }));
    queued.push(ok(GOOD_OUTPUT));
    const state = await ensureFactInventory(db, "user-a");
    expect(state.status).toBe("ready");
    expect(aiCalls).toBe(2);
  });

  it("fails closed after two invalid responses", async () => {
    const db = makeDb();
    queued.push(ok({ identity: {}, contact: {}, experience: [{ company: "X", startDate: "whenever" }] }));
    queued.push(ok({ identity: {}, contact: {}, experience: [{ company: "X", startDate: "whenever" }] }));
    await expect(ensureFactInventory(db, "user-a")).rejects.toBeInstanceOf(FactInventoryError);
    expect(aiCalls).toBe(2);
    expect(db.inventories[0].status).toBe("failed");
    expect(db.inventories[0].inventory_json).toBeNull();
  });

  it("returns not_configured when the provider key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const db = makeDb();
    const err = await ensureFactInventory(db, "user-a").catch((e) => e);
    expect((err as FactInventoryError).code).toBe("not_configured");
    expect(aiCalls).toBe(0);
  });

  it("returns model_unavailable without falling back to another model", async () => {
    const db = makeDb();
    queued.push(new Response(JSON.stringify({ error: { type: "not_found_error" } }), { status: 404 }));
    const err = await ensureFactInventory(db, "user-a").catch((e) => e);
    expect((err as FactInventoryError).code).toBe("model_unavailable");
    expect(aiCalls).toBe(1);
  });

  it("fails when the user has no current resume", async () => {
    const db = new FakeDb();
    const err = await ensureFactInventory(db, "user-a").catch((e) => e);
    expect((err as FactInventoryError).code).toBe("no_resume");
    expect(aiCalls).toBe(0);
  });

  it("fails when the stored resume text is empty", async () => {
    const db = makeDb();
    db.resumes[0].resume_text = "";
    const err = await ensureFactInventory(db, "user-a").catch((e) => e);
    expect((err as FactInventoryError).code).toBe("empty_resume");
  });

  it("does not start a second extraction while one is in flight", async () => {
    const db = makeDb();
    db.inventories.push({
      user_id: "user-a",
      resume_id: "resume-1",
      schema_version: FACT_INVENTORY_SCHEMA_VERSION,
      prompt_version: PROMPT_P0_FACT_INVENTORY.version,
      status: "extracting",
      source_hash: await computeSourceHash("resume-1", RESUME_TEXT),
      generation_started_at: new Date().toISOString(),
      inventory_json: null,
    });
    const state = await ensureFactInventory(db, "user-a");
    expect(state.status).toBe("extracting");
    expect(aiCalls).toBe(0);
  });

  it("recovers a stale lock instead of hanging forever", async () => {
    const db = makeDb();
    db.inventories.push({
      user_id: "user-a",
      resume_id: "resume-1",
      schema_version: FACT_INVENTORY_SCHEMA_VERSION,
      prompt_version: PROMPT_P0_FACT_INVENTORY.version,
      status: "extracting",
      source_hash: "old",
      generation_started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      inventory_json: null,
    });
    queued.push(ok(GOOD_OUTPUT));
    const state = await ensureFactInventory(db, "user-a");
    expect(state.status).toBe("ready");
  });

  it("never returns another user's inventory", async () => {
    const db = makeDb();
    queued.push(ok(GOOD_OUTPUT));
    await ensureFactInventory(db, "user-a");
    db.resumes.push({
      id: "resume-b",
      user_id: "user-b",
      resume_text: RESUME_TEXT,
      is_current: true,
      uploaded_at: new Date().toISOString(),
    });
    const stateB = await getFactInventoryState(db, "user-b");
    expect(stateB.status).toBe("missing");
    expect(stateB.resumeId).toBe("resume-b");
  });

  it("ignores job description, writing samples and voice card as inputs", async () => {
    const db = makeDb();
    let sentUser = "";
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const parsed = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      sentUser = parsed.messages[0].content;
      return ok(GOOD_OUTPUT);
    });
    await ensureFactInventory(db, "user-a");
    expect(sentUser).toContain("Resume text:");
    expect(sentUser).toContain("Company A");
    expect(sentUser).not.toMatch(/job description|voice card|writing sample|question/i);
  });
});
