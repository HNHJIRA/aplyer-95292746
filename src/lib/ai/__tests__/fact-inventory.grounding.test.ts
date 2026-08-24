import { describe, expect, it } from "vitest";
import {
  applyGrounding,
  GroundingError,
  isEvidenceGrounded,
  normalizeText,
} from "@/lib/ai/fact-inventory-grounding";
import {
  validateFactInventoryShape,
  isValidResumeDate,
  factId,
} from "@/lib/ai/prompts/prompt-p0-fact-inventory";

const RESUME = `Jane Doe
Berlin, Germany | jane@example.com | +49 30 111222 | linkedin.com/in/janedoe

Summary
Product-minded engineer focused on data tooling.

Experience
Company A — Software Engineer, Berlin
2021 - 2022
Helped improve conversion on the signup funnel.
Worked with React and Node.js.

Company B — Senior Engineer
2023 - Present
Built an automated reporting pipeline that reduced weekly reporting time by 6 hours.
Worked with the engineering team on migration planning.

Education
TU Berlin — BSc Computer Science, 2017 - 2021`;

function fact(value: string, evidence: string, section = "Experience — Company A (Software Engineer)") {
  return { id: "", value, evidence, sourceSection: section, confidence: "explicit" };
}

function draftWith(facts: ReturnType<typeof fact>[]) {
  return validateFactInventoryShape({
    identity: { name: "Jane Doe", location: "Berlin, Germany" },
    contact: { email: "jane@example.com", phone: null, linkedin: null, portfolio: null },
    professionalSummaryFacts: [],
    experience: [
      {
        company: "Company A",
        role: "Software Engineer",
        location: "Berlin",
        startDate: "2021",
        endDate: "2022",
        isCurrent: false,
        facts,
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
  });
}

describe("evidence grounding", () => {
  it("accepts verbatim resume fragments", () => {
    expect(isEvidenceGrounded("Helped improve conversion on the signup funnel.", normalizeText(RESUME))).toBe(true);
  });

  it("rejects invented evidence", () => {
    expect(isEvidenceGrounded("Increased conversion by 40% across all funnels", normalizeText(RESUME))).toBe(false);
  });

  it("rejects an unsupported percentage claim", () => {
    const draft = draftWith([
      fact("Improved conversion", "Helped improve conversion on the signup funnel."),
      fact("Improved conversion by 40%", "Helped improve conversion on the signup funnel."),
    ]);
    const { inventory, rejections } = applyGrounding(draft, RESUME, "resume-1");
    const values = inventory.experience[0].facts.map((f) => f.value);
    expect(values).toContain("Improved conversion");
    expect(values.join(" ")).not.toContain("40%");
    expect(rejections[0].reason).toBe("unsupported_number");
  });

  it("rejects an unsupported years-of-experience claim", () => {
    const draft = draftWith([
      fact("Worked with React", "Worked with React and Node.js."),
      fact("5 years of React experience", "Worked with React and Node.js."),
    ]);
    const { inventory } = applyGrounding(draft, RESUME, "resume-1");
    expect(inventory.experience[0].facts.map((f) => f.value)).toEqual(["Worked with React"]);
  });

  it("rejects seniority upgrades not present in evidence", () => {
    const draft = draftWith([
      fact("Worked with the engineering team", "Worked with the engineering team on migration planning."),
      fact("Managed the engineering team", "Worked with the engineering team on migration planning."),
    ]);
    const { inventory, rejections } = applyGrounding(draft, RESUME, "resume-1");
    expect(inventory.experience[0].facts).toHaveLength(1);
    expect(rejections.some((r) => r.reason === "unsupported_strengthening")).toBe(true);
  });

  it("preserves supported numbers", () => {
    const draft = draftWith([
      fact(
        "Reduced weekly reporting time by 6 hours",
        "Built an automated reporting pipeline that reduced weekly reporting time by 6 hours.",
        "Experience — Company B (Senior Engineer)",
      ),
    ]);
    const { inventory } = applyGrounding(draft, RESUME, "resume-1");
    expect(inventory.experience[0].facts).toHaveLength(1);
  });

  it("fails closed when most facts are hallucinated", () => {
    const draft = draftWith([
      fact("Raised $2M in funding", "Raised $2M in seed funding from investors"),
      fact("Managed 12 employees", "Managed a team of 12 employees"),
      fact("Worked with React", "Worked with React and Node.js."),
    ]);
    expect(() => applyGrounding(draft, RESUME, "resume-1")).toThrow(GroundingError);
  });

  it("drops identity/contact values absent from the resume", () => {
    const draft = validateFactInventoryShape({
      identity: { name: "Someone Else", location: null },
      contact: { email: "attacker@example.com", phone: null, linkedin: null, portfolio: null },
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      projects: [],
      achievements: [],
      otherFacts: [],
      professionalSummaryFacts: [],
    });
    const { inventory } = applyGrounding(draft, RESUME, "resume-1");
    expect(inventory.identity.name).toBeNull();
    expect(inventory.contact.email).toBeNull();
  });
});

describe("temporal integrity", () => {
  it("keeps facts attached to their own company and period", () => {
    const draft = validateFactInventoryShape({
      identity: { name: null, location: null },
      contact: {},
      professionalSummaryFacts: [],
      experience: [
        {
          company: "Company A",
          role: "Software Engineer",
          startDate: "2021",
          endDate: "2022",
          isCurrent: false,
          facts: [fact("Helped improve conversion", "Helped improve conversion on the signup funnel.")],
          technologies: [],
          achievements: [],
        },
        {
          company: "Company B",
          role: "Senior Engineer",
          startDate: "2023",
          endDate: null,
          isCurrent: true,
          facts: [],
          technologies: [],
          achievements: [
            fact(
              "Built an automated reporting pipeline",
              "Built an automated reporting pipeline that reduced weekly reporting time by 6 hours.",
              "Experience — Company B (Senior Engineer)",
            ),
          ],
        },
      ],
      education: [],
      skills: [],
      certifications: [],
      projects: [],
      achievements: [],
      otherFacts: [],
    });
    const { inventory } = applyGrounding(draft, RESUME, "resume-1");
    const [a, b] = inventory.experience;
    expect(a.company).toBe("Company A");
    expect(a.endDate).toBe("2022");
    expect(a.facts.map((f) => f.value)).toEqual(["Helped improve conversion"]);
    expect(b.company).toBe("Company B");
    expect(b.isCurrent).toBe(true);
    expect(b.endDate).toBeNull();
    expect(b.achievements[0].value).toContain("reporting pipeline");
    // No cross-company leakage.
    expect(a.achievements).toHaveLength(0);
    expect(b.facts).toHaveLength(0);
  });

  it("accepts year-only dates and rejects malformed ones", () => {
    expect(isValidResumeDate("2023")).toBe(true);
    expect(isValidResumeDate("May 2023")).toBe(true);
    expect(isValidResumeDate(null)).toBe(true);
    expect(isValidResumeDate("sometime in the 2020s")).toBe(false);
    expect(() =>
      validateFactInventoryShape({
        identity: {},
        contact: {},
        experience: [{ company: "X", role: "Y", startDate: "whenever" }],
      }),
    ).toThrow(/Malformed date/);
  });
});

describe("deterministic ids", () => {
  it("produces the same id for the same canonical content", () => {
    expect(factId("experience:acme:engineer:0", "achievement", "Built a pipeline")).toBe(
      factId("experience:acme:engineer:0", "achievement", "built   a pipeline!"),
    );
  });

  it("re-running extraction on the same output keeps ids stable", () => {
    const a = draftWith([fact("Worked with React", "Worked with React and Node.js.")]);
    const b = draftWith([fact("Worked with React", "Worked with React and Node.js.")]);
    expect(a.experience[0].facts[0].id).toBe(b.experience[0].facts[0].id);
  });
});

describe("structural validation", () => {
  it("rejects facts without evidence", () => {
    expect(() =>
      validateFactInventoryShape({
        identity: {},
        contact: {},
        achievements: [{ value: "Did a thing", evidence: "", sourceSection: "x", confidence: "explicit" }],
      }),
    ).toThrow(/evidence/);
  });

  it("rejects invalid confidence values", () => {
    expect(() =>
      validateFactInventoryShape({
        identity: {},
        contact: {},
        achievements: [{ value: "x", evidence: "y", sourceSection: "z", confidence: "high" }],
      }),
    ).toThrow(/confidence/);
  });

  it("defaults missing sections to empty arrays", () => {
    const d = validateFactInventoryShape({ identity: {}, contact: {} });
    expect(d.experience).toEqual([]);
    expect(d.skills).toEqual([]);
    expect(d.identity.name).toBeNull();
  });
});
