// P0 extraction-quality regression corpus, re-run after pinning P0 to Haiku.
// These are deterministic guardrail tests: they feed model-shaped drafts through
// structural validation + grounding and assert the guarantees hold.
import { describe, expect, it } from "vitest";
import { applyGrounding } from "@/lib/ai/fact-inventory-grounding";
import { validateFactInventoryShape } from "@/lib/ai/prompts/prompt-p0-fact-inventory";

const RESUME = `Jane Doe
Berlin, Germany | jane@example.com

Experience
Company A — Software Engineer
2021 - 2022
Worked with React on the customer portal.
Helped improve onboarding.

Company B — Senior Engineer
2023 - Present
Worked with React and built a reporting pipeline that reduced reporting time by 6 hours.`;

function fact(value: string, evidence: string, section: string) {
  return { id: "", value, evidence, sourceSection: section, confidence: "explicit" as const };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
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
        facts: [fact("Worked with React on the customer portal", "Worked with React on the customer portal.", "Experience — Company A")],
        technologies: [],
        achievements: [],
      },
      {
        company: "Company B",
        role: "Senior Engineer",
        location: null,
        startDate: "2023",
        endDate: null,
        isCurrent: true,
        facts: [
          fact(
            "Built a reporting pipeline that reduced reporting time by 6 hours",
            "built a reporting pipeline that reduced reporting time by 6 hours",
            "Experience — Company B",
          ),
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
    ...overrides,
  };
}

function ground(raw: unknown) {
  return applyGrounding(validateFactInventoryShape(raw), RESUME, "resume-1");
}

describe("multi-role resume", () => {
  it("keeps each achievement attached to its own company", () => {
    const { inventory } = ground(draft());
    const [a, b] = inventory.experience;
    expect(a.company).toBe("Company A");
    expect(a.facts.map((f) => f.value).join(" ")).not.toMatch(/reporting pipeline/i);
    expect(b.facts.map((f) => f.value).join(" ")).toMatch(/reporting pipeline/i);
  });

  it("rejects a metric leaked from another role", () => {
    const d = draft();
    d.experience[0].facts.push(
      fact(
        "Reduced reporting time by 6 hours at Company A",
        "Worked with React on the customer portal.",
        "Experience — Company A",
      ),
    );
    const { inventory, rejections } = ground(d);
    expect(rejections.map((r) => r.reason)).toContain("unsupported_number");
    expect(inventory.experience[0].facts).toHaveLength(1);
  });

  it("does not transfer role-specific claims when the same technology appears twice", () => {
    const d = draft();
    d.experience[0].facts.push(
      fact(
        "Used React to build the reporting pipeline",
        "Worked with React on the customer portal.",
        "Experience — Company A",
      ),
    );
    const { inventory } = ground(d);
    expect(inventory.experience[0].facts.map((f) => f.value)).toEqual([
      "Worked with React on the customer portal",
    ]);
  });
});

describe("temporal integrity", () => {
  it("preserves partial dates exactly as written", () => {
    const { inventory } = ground(draft());
    expect(inventory.experience[0].startDate).toBe("2021");
    expect(inventory.experience[1].startDate).toBe("2023");
    expect(inventory.experience[1].endDate).toBeNull();
    expect(inventory.experience[1].isCurrent).toBe(true);
  });

  it("rejects invented day-level granularity", () => {
    const d = draft();
    d.experience[0].startDate = "March 15, 2021";
    expect(() => ground(d)).toThrow();
  });

  it("rejects an unsupported years-of-experience claim", () => {
    const d = draft();
    d.experience[0].facts.push(
      fact("5 years of React experience", "Worked with React on the customer portal.", "Experience — Company A"),
    );
    const { rejections } = ground(d);
    expect(rejections.some((r) => r.reason === "unsupported_duration" || r.reason === "unsupported_number")).toBe(true);
  });
});

describe("missing fields are never supplemented", () => {
  it("keeps phone null when the resume has no phone number", () => {
    const d = draft({
      contact: { email: "jane@example.com", phone: "+49 170 1234567", linkedin: null, portfolio: null },
    });
    const { inventory } = ground(d);
    expect(inventory.contact.phone).toBeNull();
    expect(inventory.contact.email).toBe("jane@example.com");
  });
});

describe("ambiguous claims are not strengthened", () => {
  it("rejects 'Led onboarding transformation' built from 'Helped improve onboarding'", () => {
    const d = draft();
    d.experience[0].facts.push(
      fact("Led onboarding transformation", "Helped improve onboarding.", "Experience — Company A"),
    );
    const { inventory, rejections } = ground(d);
    expect(rejections.map((r) => r.reason)).toContain("unsupported_strengthening");
    expect(inventory.experience[0].facts.map((f) => f.value)).not.toContain("Led onboarding transformation");
  });
});
