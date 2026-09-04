import { describe, expect, it } from "vitest";
import {
  checkCandidateVoice,
  checkCurrentYear,
  checkDashes,
  checkGrounding,
  checkRuleOfThree,
  checkStrengths,
  extractCandidateNames,
  orderRedFlags,
  parseEmploymentHistory,
  runResumeAuditGuards,
  type GeneratedField,
} from "@/lib/ai/resume-audit-guards";
import {
  PROMPT_C_RESUME_AUDIT,
  buildResumeAuditUser,
  formatAuditDate,
  validateResumeAudit,
} from "@/lib/ai/prompts/prompt-c-resume-audit";

const f = (text: string): GeneratedField[] => [{ field: "test", text }];
const codes = (v: { code: string }[]) => v.map((x) => x.code);

const MARCUS = `Marcus Johnson
marcus.johnson@example.com | 555-0100

PROFESSIONAL SUMMARY
Marketing operations leader.

EXPERIENCE
Mailchimp
Senior Marketing Operations Manager
Mar 2022 - Present
Ran lifecycle campaigns and reporting.

Cox Communications
Marketing Operations Analyst
Jun 2019 - Feb 2022
Owned reporting for retention programs. Improved conversion by 18%.

Home Depot
Marketing Coordinator
Aug 2016 - May 2019
Supported store marketing.

SKILLS
Salesforce, Excel, SQL`;

const SARAH = `Sarah Chen
sarah.chen@example.com

EXPERIENCE
Stripe
Product Designer
Jan 2023 - Present
Designed onboarding flows.

Figma
Designer
2020 - 2022
Worked on design systems.`;

const JENNIFER = `Jennifer Martinez
jennifer@example.com

EXPERIENCE
Kaiser Permanente
Registered Nurse
Feb 2021 - Present
Led triage for 40 beds.

Sutter Health
Staff Nurse
2017 - 2021
Supported acute care.`;

const DAVID = `David Park
david.park@example.com

EXPERIENCE
Snowflake
Data Engineer
Sep 2022 - Present
Built pipelines in Python and SQL.

Oracle
Analyst
2018 - 2022
Reported on licensing.`;

const flag = (
  flagText: string,
  employer: string | null,
  why = "This costs you interviews.",
  fix = "Rewrite the line.",
) => ({ flag: flagText, whyPoints: [why], fixPoints: [fix], employer });

describe("resume audit guards: punctuation", () => {
  it("1. rejects an em dash", () => {
    expect(codes(checkDashes(f("Your summary is vague \u2014 fix it.")))).toContain("em_dash");
  });

  it("2. rejects an en dash", () => {
    expect(codes(checkDashes(f("Your summary is vague \u2013 fix it.")))).toContain("en_dash");
  });

  it("3. rejects a hyphen used as punctuation", () => {
    expect(codes(checkDashes(f("Your summary is vague - fix it.")))).toContain("prohibited_hyphen");
  });

  it("allows hyphens inside compound words", () => {
    expect(checkDashes(f("Your cross-functional, data-driven work reads well."))).toHaveLength(0);
  });
});

describe("resume audit guards: rule of three", () => {
  it("4. rejects a three-item list", () => {
    const v = checkRuleOfThree(f("You show clear progression, real metrics, and a compelling headline."));
    expect(codes(v)).toContain("rule_of_three");
  });

  it("rejects a three-item list without an Oxford comma", () => {
    expect(codes(checkRuleOfThree(f("You managed hiring, training and retention.")))).toContain(
      "rule_of_three",
    );
  });

  it("5. accepts a two-item sentence", () => {
    expect(checkRuleOfThree(f("You managed hiring and retention."))).toHaveLength(0);
  });

  it("6. accepts a four-item sentence", () => {
    expect(
      checkRuleOfThree(f("You managed hiring, training, retention, and payroll.")),
    ).toHaveLength(0);
  });
});

describe("resume audit guards: candidate-facing voice", () => {
  const names = extractCandidateNames(MARCUS);

  it("extracts the candidate name from the resume header", () => {
    expect(names).toEqual(expect.arrayContaining(["Marcus", "Johnson"]));
  });

  it("7. rejects the candidate name in generated text", () => {
    expect(codes(checkCandidateVoice(f("This undersells Marcus's role."), names))).toContain(
      "candidate_name_reference",
    );
  });

  it("8. rejects he/she/his/her in generated commentary", () => {
    for (const text of ["Did he design the process?", "Did she own it?", "his scope", "her scope"]) {
      expect(codes(checkCandidateVoice(f(text), names))).toContain("third_person_pronoun");
    }
  });

  it("9. accepts 'your role'", () => {
    expect(checkCandidateVoice(f("This undersells your role and your experience."), names)).toHaveLength(0);
  });

  it("never treats the resume itself as generated commentary", () => {
    const audit = {
      overallTakePoints: ["Your resume reads clean."],
      redFlags: [flag("Weak summary", "Mailchimp")],
      strengths: ["Strong recent progression at a recognisable brand."],
      topPriority: "Quantify your top bullet.",
    };
    expect(runResumeAuditGuards(audit, { resumeText: MARCUS, now: new Date("2026-09-04T00:00:00Z") })).toHaveLength(0);
  });
});

describe("resume audit guards: strengths", () => {
  it("10. rejects duplicate consecutive opening words", () => {
    const v = checkStrengths([
      "Nearly every bullet carries a number.",
      "Nearly all roles show progression.",
    ]);
    expect(codes(v)).toContain("duplicate_strength_opening");
  });

  it("11. accepts one-idea strengths with varied openings", () => {
    expect(
      checkStrengths([
        "Nearly every bullet carries a number.",
        "Titles show clean upward progression.",
        "Formatting parses cleanly in most systems.",
      ]),
    ).toHaveLength(0);
  });

  it("12. rejects a strength over the length limit", () => {
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
    expect(codes(checkStrengths([long]))).toContain("strength_too_long");
  });
});

describe("resume audit guards: current year", () => {
  const now = new Date("2026-09-04T00:00:00Z");

  it("13. accepts a historical resume date", () => {
    expect(checkCurrentYear(f("Your certification from 2025 is still relevant."), now)).toHaveLength(0);
    expect(checkCurrentYear(f("You left that role in 2025."), now)).toHaveLength(0);
  });

  it("14. rejects an incorrect current-year statement", () => {
    expect(codes(checkCurrentYear(f("As of 2025, recruiters expect metrics."), now))).toContain(
      "current_year_mismatch",
    );
    expect(codes(checkCurrentYear(f("This resume is being reviewed in 2025."), now))).toContain(
      "current_year_mismatch",
    );
  });

  it("15. accepts a valid runtime-year statement", () => {
    expect(checkCurrentYear(f("As of 2026, recruiters expect metrics."), now)).toHaveLength(0);
    expect(checkCurrentYear(f("This resume is being reviewed in 2026."), now)).toHaveLength(0);
  });
});

describe("resume audit guards: grounding", () => {
  it("16. rejects an unsupported employer", () => {
    expect(codes(checkGrounding(f("Your time at Google Cloud is undersold."), MARCUS))).toContain(
      "ungrounded_employer",
    );
  });

  it("accepts an employer that exists in the resume", () => {
    expect(checkGrounding(f("Your Cox Communications bullets need numbers."), MARCUS)).toHaveLength(0);
  });

  it("17. rejects an unsupported metric", () => {
    expect(codes(checkGrounding(f("You claim 42% growth without context."), MARCUS))).toContain(
      "ungrounded_metric",
    );
  });

  it("accepts a metric that exists in the resume", () => {
    expect(checkGrounding(f("Your 18% conversion line is the strongest one."), MARCUS)).toHaveLength(0);
  });

  it("18. rejects an unsupported tool", () => {
    expect(codes(checkGrounding(f("You never mention how you used HubSpot."), MARCUS))).toContain(
      "ungrounded_tool",
    );
  });

  it("accepts a tool that exists in the resume", () => {
    expect(checkGrounding(f("Your Salesforce work needs one number."), MARCUS)).toHaveLength(0);
  });
});

describe("resume audit ordering", () => {
  it("parses employment history newest first by end date", () => {
    const history = parseEmploymentHistory(MARCUS);
    expect(history).toHaveLength(3);
    expect(history[0]!.label).toContain("Mailchimp");
  });

  it("19. sorts employment red flags newest to oldest", () => {
    const ordered = orderRedFlags(
      [
        flag("Home Depot bullets are duty lists", "Home Depot"),
        flag("Mailchimp scope is unclear", "Mailchimp"),
        flag("Cox Communications lacks numbers", "Cox Communications"),
      ],
      MARCUS,
    );
    expect(ordered.map((x) => x.employer)).toEqual(["Mailchimp", "Cox Communications", "Home Depot"]);
  });

  it("20. keeps non-employment flags after employment flags", () => {
    const ordered = orderRedFlags(
      [
        { ...flag("Skills section is a keyword dump", null), whyPoints: ["It reads generic."] },
        flag("Home Depot bullets are duty lists", "Home Depot"),
        { ...flag("No certifications listed", null), whyPoints: ["Screens filter on this."] },
        flag("Mailchimp scope is unclear", "Mailchimp"),
      ],
      MARCUS,
    );
    expect(ordered.map((x) => x.flag)).toEqual([
      "Mailchimp scope is unclear",
      "Home Depot bullets are duty lists",
      "Skills section is a keyword dump",
      "No certifications listed",
    ]);
  });

  it("21. produces the expected Marcus ordering regardless of model order", () => {
    const modelOrder = [
      flag("Mailchimp scope is unclear", "Mailchimp"),
      flag("Home Depot bullets are duty lists", "Home Depot"),
      flag("Cox Communications lacks numbers", "Cox Communications"),
    ];
    expect(orderRedFlags(modelOrder, MARCUS).map((x) => x.employer)).toEqual([
      "Mailchimp",
      "Cox Communications",
      "Home Depot",
    ]);
  });

  it("matches employers from flag text when employer is null", () => {
    const ordered = orderRedFlags(
      [
        flag("Oldest role dominates the page", null, "Your Oracle bullets run long."),
        flag("Recent role is thin", null, "Your Snowflake section has one line."),
      ],
      DAVID,
    );
    expect(ordered[0]!.flag).toBe("Recent role is thin");
  });
});

describe("regression corpus", () => {
  const now = new Date("2026-09-04T00:00:00Z");
  const corpus: Array<[string, string, string[]]> = [
    ["Sarah Chen", SARAH, ["Stripe", "Figma"]],
    ["Marcus Johnson", MARCUS, ["Mailchimp", "Cox Communications", "Home Depot"]],
    ["Jennifer Martinez", JENNIFER, ["Kaiser Permanente", "Sutter Health"]],
    ["David Park", DAVID, ["Snowflake", "Oracle"]],
  ];

  for (const [name, resume, employers] of corpus) {
    it(`${name}: orders employment flags newest to oldest`, () => {
      const shuffled = [...employers].reverse().map((e) => flag(`${e} bullets need numbers`, e));
      expect(orderRedFlags(shuffled, resume).map((x) => x.employer)).toEqual(employers);
    });

    it(`${name}: a compliant audit passes every guard`, () => {
      const audit = {
        overallTakePoints: ["Your resume reads clean.", "Scope stays unclear in places."],
        redFlags: employers.map((e) => flag(`${e} bullets need numbers`, e)),
        strengths: [
          "Titles show clean upward progression.",
          "Formatting parses cleanly in most systems.",
          "Recent work sits at the top of the page.",
        ],
        topPriority: "Quantify your most recent bullet.",
      };
      expect(runResumeAuditGuards(audit, { resumeText: resume, now })).toHaveLength(0);
    });

    it(`${name}: the reported defects are caught`, () => {
      const nameTokens = extractCandidateNames(resume);
      const bad = {
        overallTakePoints: [`This undersells ${nameTokens[0]}'s role \u2014 badly.`],
        redFlags: [
          {
            flag: "Weak summary",
            whyPoints: ["Did he design the process?"],
            fixPoints: ["Show ownership, impact, and scale."],
            employer: employers[0] ?? null,
          },
        ],
        strengths: ["Nearly every bullet lands.", "Nearly all roles progress."],
        topPriority: "As of 2025, recruiters expect metrics.",
      };
      const found = codes(runResumeAuditGuards(bad, { resumeText: resume, now }));
      expect(found).toEqual(
        expect.arrayContaining([
          "em_dash",
          "candidate_name_reference",
          "third_person_pronoun",
          "rule_of_three",
          "duplicate_strength_opening",
          "current_year_mismatch",
        ]),
      );
    });
  }
});

describe("prompt C v3", () => {
  it("is pinned and versioned", () => {
    expect(PROMPT_C_RESUME_AUDIT.version).toBe("3.0.0");
    expect(PROMPT_C_RESUME_AUDIT.id).toBe("C_RESUME_AUDIT");
    expect(PROMPT_C_RESUME_AUDIT.json).toBe(true);
  });

  it("injects the runtime date without hardcoding a year", () => {
    const now = new Date("2026-09-04T10:00:00Z");
    const user = buildResumeAuditUser("resume text", now);
    expect(user).toContain("Today's date is 2026-09-04.");
    expect(user).toContain("Judge all recency and date claims against this date.");
    expect(formatAuditDate(new Date("2031-01-02T00:00:00Z"))).toBe("2031-01-02");
    expect(PROMPT_C_RESUME_AUDIT.system).not.toMatch(/\b20\d{2}\b/);
  });

  it("validates the structured shape and builds legacy aliases", () => {
    const audit = validateResumeAudit({
      overallTakePoints: ["Clean resume.", "Scope unclear."],
      redFlags: [
        { flag: "Weak summary", whyPoints: ["It is generic."], fixPoints: ["Rewrite it."], employer: "Mailchimp" },
      ],
      strengths: [{ point: "Titles progress cleanly." }],
      topPriority: "Quantify your top bullet.",
    });
    expect(audit.overallTake).toBe("Clean resume. Scope unclear.");
    expect(audit.redFlags[0]!.why).toBe("It is generic.");
    expect(audit.redFlags[0]!.fix).toBe("Rewrite it.");
    expect(audit.strengths[0]!.point).toBe("Titles progress cleanly.");
  });

  it("accepts legacy model output shapes", () => {
    const audit = validateResumeAudit({
      overallTake: "Clean resume. Scope unclear.",
      redFlags: [{ issue: "Weak summary", why: "It is generic.", fix: "Rewrite it." }],
      strengths: ["Titles progress cleanly."],
      closing: "Quantify your top bullet.",
    });
    expect(audit.overallTakePoints).toHaveLength(2);
    expect(audit.redFlags[0]!.flag).toBe("Weak summary");
    expect(audit.redFlags[0]!.whyPoints).toEqual(["It is generic."]);
    expect(audit.redFlags[0]!.employer).toBeNull();
    expect(audit.strengths[0]!.point).toBe("Titles progress cleanly.");
  });
});
