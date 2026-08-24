// Regression suite for the role-aware temporal guard.
import { describe, expect, it } from "vitest";
import { flattenInventory } from "../answer-facts";
import { runAnswerGuards } from "../answer-guards";
import { evaluateTemporal, normalizeDateExpression, roleYears } from "../temporal";
import type { ResumeFactInventory } from "../prompts/prompt-p0-fact-inventory";

const fact = (id: string, value: string, evidence = value) => ({
  id,
  value,
  evidence,
  sourceSection: "experience",
  confidence: "explicit" as const,
});

function inventory(
  experience: ResumeFactInventory["experience"],
): ResumeFactInventory {
  return {
    schemaVersion: "1.0.0",
    sourceResumeId: "resume-1",
    identity: { name: "Sam Rivera", location: null },
    contact: { email: null, phone: null, linkedin: null, portfolio: null },
    professionalSummaryFacts: [],
    experience,
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    achievements: [],
    otherFacts: [],
  } as ResumeFactInventory;
}

const ROLE_A = {
  id: "e1",
  company: "Northwind",
  role: "Senior Engineer",
  location: null,
  startDate: "2021",
  endDate: "2022",
  isCurrent: false,
  facts: [fact("f1", "Rebuilt the checkout service")],
  technologies: [fact("f2", "React")],
  achievements: [],
};

const ROLE_B = {
  id: "e2",
  company: "Bluepeak",
  role: "Engineer",
  location: null,
  startDate: "2023",
  endDate: "2025",
  isCurrent: false,
  facts: [fact("f3", "Delivered a 40 percent signup improvement")],
  technologies: [fact("f4", "Python")],
  achievements: [],
};

const twoRoles = flattenInventory(inventory([ROLE_A, ROLE_B]));

const yearOnly = flattenInventory(
  inventory([{ ...ROLE_A, startDate: "2023", endDate: "2023" }]),
);

const rangeOnly = flattenInventory(
  inventory([{ ...ROLE_A, startDate: "2021", endDate: "2023" }]),
);

const currentRole = flattenInventory(
  inventory([{ ...ROLE_A, startDate: "2021", endDate: null, isCurrent: true }]),
);

const codes = (answer: string, flat = twoRoles) =>
  evaluateTemporal(answer, flat).filter((v) => v.blocking).map((v) => v.code);

describe("date normalization", () => {
  it("canonicalizes dash, en-dash and 'to' ranges identically", () => {
    const forms = ["2021-2023", "2021–2023", "2021 — 2023", "2021 to 2023"];
    const normalized = new Set(forms.map(normalizeDateExpression));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe("2021-2023");
  });

  it("canonicalizes open-ended markers to 'present'", () => {
    for (const s of ["Present", "current", "Now", "ongoing"]) {
      expect(normalizeDateExpression(`2021 - ${s}`)).toBe("2021-present");
    }
  });

  it("expands month abbreviations without inventing precision", () => {
    expect(normalizeDateExpression("Jan 2023")).toBe("january 2023");
    expect(normalizeDateExpression("2023")).toBe("2023");
  });

  it("expands a role window across its full year range", () => {
    expect([...roleYears({ ...ROLE_B, index: 1 })]).toEqual(["2023", "2024", "2025"]);
  });
});

describe("granularity", () => {
  it("allows year-only reference when the inventory states that year", () => {
    expect(codes("In 2023, the checkout rebuild shipped.", yearOnly)).toEqual([]);
    expect(codes("During 2023 the rebuild shipped.", yearOnly)).toEqual([]);
  });

  it("rejects an invented month against a year-only inventory", () => {
    expect(codes("In March 2023, the checkout rebuild shipped.", yearOnly)).toContain(
      "unsupported_date_precision",
    );
  });

  it("rejects invented quarter precision", () => {
    expect(codes("Q2 2023 was when the rebuild shipped.", yearOnly)).toContain(
      "unsupported_date_precision",
    );
  });

  it("accepts a range without demanding months", () => {
    expect(codes("From 2021 to 2023, the platform work continued.", rangeOnly)).toEqual([]);
  });

  it("rejects a year the inventory never states", () => {
    expect(codes("In 2019 the rebuild shipped.", yearOnly)).toContain("unsupported_date");
  });

  it("does not read the modal verb 'may' as a month", () => {
    expect(codes("That approach may seem cautious, though it held up in 2023.", yearOnly)).toEqual([]);
  });
});

describe("role-aware attribution", () => {
  it("passes a year that belongs to the role named in the sentence", () => {
    expect(codes("At Northwind in 2021, the checkout service was rebuilt.")).toEqual([]);
  });

  it("blocks a year that belongs to a different employer", () => {
    expect(codes("At Northwind in 2024, the signup work landed.")).toContain(
      "cross_role_temporal_mismatch",
    );
  });

  it("blocks another employer's metric attributed to this role", () => {
    const r = runAnswerGuards(
      "At Northwind in 2021, the 40 percent signup improvement was delivered across the platform team, which is the piece of work that still stands out most clearly when the checkout rebuild and the surrounding reliability effort are described in full detail today.",
      twoRoles,
    );
    expect(r.violations.some((v) => v.code === "cross_role_attribution")).toBe(true);
  });
});

describe("tense", () => {
  it("blocks present tense on a role that has ended", () => {
    expect(codes("At Northwind I currently lead the platform team.")).toContain(
      "invalid_current_tense",
    );
  });

  it("allows historical tense on a role that has ended", () => {
    expect(codes("At Northwind the platform team was led through the checkout rebuild.")).toEqual([]);
  });

  it("allows present tense for a current role", () => {
    expect(codes("At Northwind I currently lead the platform team.", currentRole)).toEqual([]);
  });
});

describe("non-contradictory phrasing", () => {
  it("passes an answer with no date references at all", () => {
    expect(codes("The checkout service rebuild at Northwind reduced support load.")).toEqual([]);
  });

  it("reports an ambiguous reference without blocking it", () => {
    const all = evaluateTemporal("Last year the checkout rebuild shipped.", twoRoles);
    expect(all.some((v) => v.code === "ambiguous_temporal_reference" && !v.blocking)).toBe(true);
    expect(all.filter((v) => v.blocking)).toEqual([]);
  });
});
