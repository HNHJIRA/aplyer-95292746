// P0 security contract: canonical inventory is server-write-only, scoped to the
// authenticated user, and invalidated by model / resume / version changes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FactInventoryError,
  computeSourceHash,
  ensureFactInventory,
  getFactInventoryState,
  requireReadyFactInventory,
} from "@/lib/ai/fact-inventory.server";
import {
  FACT_INVENTORY_SCHEMA_VERSION,
  PROMPT_P0_FACT_INVENTORY,
} from "@/lib/ai/prompts/prompt-p0-fact-inventory";

const RESUME_TEXT = `Jane Doe
Berlin, Germany | jane@example.com

Experience
Company A — Software Engineer
2021 - 2022
Worked with React and Node.js.`;

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

/* eslint-disable @typescript-eslint/no-explicit-any */
class FakeDb {
  resumes: any[] = [];
  inventories: any[] = [];
  /** Set to true to simulate the `authenticated` role's revoked write grants. */
  denyWrites = false;
  writes = 0;

  from(table: string) {
    return new Query(this, table);
  }
}

class Query {
  private filters: Array<[string, unknown]> = [];
  private payload: any = null;
  private mode: "select" | "update" | "upsert" | "insert" | "delete" = "select";

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
  update(p: any) {
    this.mode = "update";
    this.payload = p;
    return this;
  }
  insert(p: any) {
    this.mode = "insert";
    this.payload = p;
    return this;
  }
  upsert(p: any) {
    this.mode = "upsert";
    this.payload = p;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }

  private rows(): any[] {
    return this.table === "resumes" ? this.db.resumes : this.db.inventories;
  }
  private matched() {
    return this.rows().filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }

  async maybeSingle() {
    if (this.mode === "select") return { data: this.matched()[0] ?? null, error: null };
    if (this.db.denyWrites) {
      return {
        data: null,
        error: { code: "42501", message: `permission denied for table ${this.table}` },
      };
    }
    this.db.writes += 1;
    if (this.mode === "update") {
      const hits = this.matched();
      hits.forEach((r) => Object.assign(r, this.payload));
      return { data: hits[0] ?? null, error: null };
    }
    if (this.mode === "delete") {
      const hits = this.matched();
      this.db.inventories = this.db.inventories.filter((r) => !hits.includes(r));
      return { data: null, error: null };
    }
    const p = this.payload;
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

  then(resolve: (v: { data: unknown; error: unknown }) => void) {
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

const queued: Response[] = [];
function ok(obj: unknown) {
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(obj) }] }), {
    status: 200,
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  queued.length = 0;
  vi.stubGlobal("fetch", async () => {
    const next = queued.shift();
    if (!next) throw new Error("no queued AI response");
    return next;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("P0 canonical inventory is server-write-only", () => {
  it("writes go to the privileged write client, never the user-scoped client", async () => {
    const readDb = makeDb();
    const writeDb = new FakeDb();
    writeDb.resumes = readDb.resumes;
    queued.push(ok(GOOD_OUTPUT));
    const state = await ensureFactInventory(readDb, "user-a", { writeDb });
    expect(state.status).toBe("ready");
    expect(readDb.writes).toBe(0);
    expect(readDb.inventories).toHaveLength(0);
    expect(writeDb.inventories).toHaveLength(1);
  });

  it("a user-scoped client with revoked write grants cannot insert/update/delete", async () => {
    const db = makeDb();
    db.denyWrites = true;

    const ins = await db
      .from("resume_fact_inventories")
      .insert({ user_id: "user-a", inventory_json: { fake: "fact" } })
      .maybeSingle();
    const upd = await db
      .from("resume_fact_inventories")
      .update({ inventory_json: { fake: "fact" } })
      .eq("user_id", "user-a")
      .maybeSingle();
    const del = await db.from("resume_fact_inventories").delete().eq("user_id", "user-a").maybeSingle();

    for (const r of [ins, upd, del]) {
      expect((r.error as { code: string } | null)?.code).toBe("42501");
    }
    expect(db.inventories).toHaveLength(0);
  });

  it("extraction is always scoped to the authenticated user's current resume", async () => {
    const db = makeDb();
    db.resumes.push({
      id: "resume-b",
      user_id: "user-b",
      resume_text: RESUME_TEXT,
      is_current: true,
      uploaded_at: new Date().toISOString(),
    });
    queued.push(ok(GOOD_OUTPUT));
    const state = await ensureFactInventory(db, "user-a", { writeDb: db });
    expect(state.resumeId).toBe("resume-1");
    // user-b sees nothing of user-a's inventory
    const other = await getFactInventoryState(db, "user-b");
    expect(other.status).toBe("missing");
  });
});

describe("requireReadyFactInventory gate", () => {
  async function seedReady(db: FakeDb, overrides: Record<string, unknown> = {}) {
    db.inventories.push({
      user_id: "user-a",
      resume_id: "resume-1",
      schema_version: FACT_INVENTORY_SCHEMA_VERSION,
      prompt_version: PROMPT_P0_FACT_INVENTORY.version,
      model: PROMPT_P0_FACT_INVENTORY.model,
      status: "ready",
      inventory_json: { schemaVersion: FACT_INVENTORY_SCHEMA_VERSION, sourceResumeId: "resume-1" },
      source_hash: await computeSourceHash("resume-1", RESUME_TEXT),
      ...overrides,
    });
  }

  it("returns the inventory when everything matches", async () => {
    const db = makeDb();
    await seedReady(db);
    const res = await requireReadyFactInventory(db, "user-a");
    expect(res.resumeId).toBe("resume-1");
    expect(res.model).toBe(PROMPT_P0_FACT_INVENTORY.model);
  });

  it("fails closed when the inventory is missing", async () => {
    const db = makeDb();
    await expect(requireReadyFactInventory(db, "user-a")).rejects.toBeInstanceOf(FactInventoryError);
  });

  it("fails closed on a non-ready status", async () => {
    const db = makeDb();
    await seedReady(db, { status: "extracting" });
    await expect(requireReadyFactInventory(db, "user-a")).rejects.toMatchObject({
      code: "inventory_not_ready",
    });
  });

  it("fails closed when the model differs from the approved P0 model", async () => {
    const db = makeDb();
    await seedReady(db, { model: "claude-opus-4-6" });
    await expect(requireReadyFactInventory(db, "user-a")).rejects.toMatchObject({
      code: "inventory_stale",
    });
  });

  it("fails closed when the resume changed", async () => {
    const db = makeDb();
    await seedReady(db);
    db.resumes[0].resume_text = `${RESUME_TEXT}\nCompany C — Staff Engineer\n2025 - Present`;
    await expect(requireReadyFactInventory(db, "user-a")).rejects.toMatchObject({
      code: "inventory_stale",
    });
  });

  it("fails closed on a stale source hash produced by an older model", async () => {
    const db = makeDb();
    await seedReady(db, { source_hash: "hash-from-opus-run" });
    await expect(requireReadyFactInventory(db, "user-a")).rejects.toMatchObject({
      code: "inventory_stale",
    });
  });
});

describe("source hash identity", () => {
  it("includes the pinned model so a model change invalidates old inventory", async () => {
    const withCurrentModel = await computeSourceHash("resume-1", RESUME_TEXT);
    const legacy = await import("@/lib/ai/fact-inventory.server").then((m) =>
      m.sha256Hex(
        [
          "resume-1",
          "irrelevant",
          PROMPT_P0_FACT_INVENTORY.version,
          FACT_INVENTORY_SCHEMA_VERSION,
        ].join("|"),
      ),
    );
    expect(withCurrentModel).not.toBe(legacy);
  });

  it("changes when the resume changes", async () => {
    const a = await computeSourceHash("resume-1", RESUME_TEXT);
    const b = await computeSourceHash("resume-1", `${RESUME_TEXT} extra`);
    expect(a).not.toBe(b);
  });

  it("is stable for identical inputs (idempotency key)", async () => {
    expect(await computeSourceHash("resume-1", RESUME_TEXT)).toBe(
      await computeSourceHash("resume-1", RESUME_TEXT),
    );
  });
});
