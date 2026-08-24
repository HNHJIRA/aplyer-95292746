import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractResumeText, looksLikeBinaryResumeText } from "@/lib/resume/extract";
import { needsTextRepair } from "@/lib/resume/repair.server";

const RESUME_TEXT = `Jane Doe
Berlin, Germany | jane@example.com

Experience
Company A — Software Engineer
2021 - 2022
Worked with React and Node.js.

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

/* ---------------- fake db ---------------- */

class FakeDb {
  resumes: Record<string, unknown>[] = [];
  inventories: Record<string, unknown>[] = [];
  storageFiles: Record<string, Uint8Array> = {};

  from(table: string) {
    return new Query(this, table);
  }

  storage = {
    from: (_bucket: string) => ({
      download: async (path: string) => {
        const bytes = this.storageFiles[path];
        if (!bytes) return { data: null, error: { message: "not found" } };
        return { data: new Blob([bytes as unknown as BlobPart]), error: null };
      },
    }),
  };
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

  private rows() {
    return this.table === "resumes" ? this.db.resumes : this.db.inventories;
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
    const p = this.payload as Record<string, unknown>;
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

const db = new FakeDb();
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return db;
  },
}));

function ok(obj: unknown) {
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(obj) }] }), { status: 200 });
}

let aiCalls = 0;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  db.resumes = [];
  db.inventories = [];
  db.storageFiles = {};
  aiCalls = 0;
  vi.stubGlobal("fetch", async () => {
    aiCalls += 1;
    return ok(GOOD_OUTPUT);
  });
});

function docxBytes(text: string): Uint8Array {
  const xml = `<?xml version="1.0"?><w:document><w:body>${text
    .split("\n")
    .map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
  return zipSync({ "word/document.xml": strToU8(xml) });
}

/* ---------------- tests ---------------- */

describe("binary resume text detection", () => {
  it("flags raw PDF bytes stored as resume text", () => {
    expect(looksLikeBinaryResumeText("%PDF-1.4\n1 0 obj\nendobj")).toBe(true);
    expect(needsTextRepair("%PDF-1.4 stream")).toBe(true);
  });

  it("accepts real extracted text", () => {
    expect(looksLikeBinaryResumeText(RESUME_TEXT)).toBe(false);
    expect(needsTextRepair(RESUME_TEXT)).toBe(false);
  });

  it("flags text that is too short to ground", () => {
    expect(needsTextRepair("Jane Doe")).toBe(true);
  });
});

describe("canonical extractor", () => {
  it("extracts DOCX paragraphs as plain text", async () => {
    const text = await extractResumeText(docxBytes(RESUME_TEXT), "cv.docx");
    expect(text).toContain("Company A — Software Engineer");
    expect(looksLikeBinaryResumeText(text)).toBe(false);
  });
});

describe("automatic profile-context preparation", () => {
  it("repairs a binary resume_text from storage and extracts the inventory", async () => {
    const { ensureReadyFactInventory } = await import("@/lib/ai/fact-inventory.server");
    db.storageFiles["u/cv.docx"] = docxBytes(RESUME_TEXT);
    db.resumes.push({
      id: "resume-1",
      user_id: "user-a",
      resume_text: "%PDF-1.4\nstream\nendobj",
      storage_path: "u/cv.docx",
      file_name: "cv.docx",
      is_current: true,
      uploaded_at: new Date().toISOString(),
    });

    const gate = await ensureReadyFactInventory(db, "user-a", { writeDb: db });
    expect(gate.inventory).toBeTruthy();
    expect(db.resumes[0].resume_text).toContain("Jane Doe");
    expect(aiCalls).toBeGreaterThan(0);
  });

  it("re-runs extraction automatically after a previous failure", async () => {
    const { ensureReadyFactInventory } = await import("@/lib/ai/fact-inventory.server");
    db.resumes.push({
      id: "resume-1",
      user_id: "user-a",
      resume_text: RESUME_TEXT,
      storage_path: "u/cv.docx",
      file_name: "cv.docx",
      is_current: true,
      uploaded_at: new Date().toISOString(),
    });
    const { FACT_INVENTORY_SCHEMA_VERSION, PROMPT_P0_FACT_INVENTORY } = await import(
      "@/lib/ai/prompts/prompt-p0-fact-inventory"
    );
    db.inventories.push({
      user_id: "user-a",
      resume_id: "resume-1",
      schema_version: FACT_INVENTORY_SCHEMA_VERSION,
      prompt_version: PROMPT_P0_FACT_INVENTORY.version,
      status: "failed",
      error: "grounding_failed",
      inventory_json: null,
      source_hash: "old",
    });

    const gate = await ensureReadyFactInventory(db, "user-a", { writeDb: db });
    expect(gate.inventory).toBeTruthy();
    expect(db.inventories[0].status).toBe("ready");
  });

  it("still fails closed when there is no resume at all", async () => {
    const { ensureReadyFactInventory, FactInventoryError } = await import("@/lib/ai/fact-inventory.server");
    await expect(ensureReadyFactInventory(db, "user-a", { writeDb: db })).rejects.toBeInstanceOf(FactInventoryError);
    expect(aiCalls).toBe(0);
  });
});
