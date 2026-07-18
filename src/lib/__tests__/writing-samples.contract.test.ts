import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { WritingSampleType } from "@/lib/storage/types";

const ALLOWED: WritingSampleType[] = [
  "cover_letter",
  "professional_email",
  "linkedin_post",
  "blog",
  "essay",
  "career_summary",
  "free_text",
  "other",
];

const uiSrc = readFileSync(
  resolve(__dirname, "../../components/extension/screens/WritingSamples.tsx"),
  "utf8",
);
const dashSrc = readFileSync(
  resolve(__dirname, "../../routes/_authenticated/dashboard.writing.tsx"),
  "utf8",
);

describe("Writing samples type contract", () => {
  it("extension UI never offers personal_bio", () => {
    expect(uiSrc).not.toMatch(/personal_bio/);
  });

  it("dashboard UI never offers personal_bio", () => {
    expect(dashSrc).not.toMatch(/personal_bio/);
  });

  it("extension UI only exposes the allowed type ids", () => {
    // Extract `id: "..."` occurrences inside the TYPES array literal.
    const ids = Array.from(uiSrc.matchAll(/id:\s*"([a-z_]+)"/g)).map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(ALLOWED).toContain(id as WritingSampleType);
    }
  });

  it("dashboard UI only exposes the allowed type ids", () => {
    const ids = Array.from(dashSrc.matchAll(/v:\s*"([a-z_]+)"/g)).map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(ALLOWED).toContain(id as WritingSampleType);
    }
  });

  it("extension UI persists the draft and calls the backend sync helper", () => {
    expect(uiSrc).toMatch(/writingSampleDraft/);
    expect(uiSrc).toMatch(/syncWritingSampleToBackend/);
    expect(uiSrc).toMatch(/hydrateFromBackend/);
  });

  it("save flow clears the draft after successful persist", () => {
    // The save() body should reach `clearDraft` on the success path.
    expect(uiSrc).toMatch(/await\s+syncWritingSampleToBackend[\s\S]{0,1500}clearDraft/);
  });
});
