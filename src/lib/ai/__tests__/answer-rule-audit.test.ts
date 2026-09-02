/**
 * 29-Rule Answer Audit — deterministic contract.
 *
 * The audit must be pure: same input -> byte-identical result (minus the
 * timestamp), and it must never reach for a model or the network.
 */
import { describe, it, expect, vi } from "vitest";
import { auditAnswerRules, auditSummary, RULES, TOTAL_RULES, RULE_AUDIT_VERSION } from "../answer-rule-audit";
import type { RuleContext } from "../answer-rule-audit";
import type { FlattenedInventory } from "../answer-facts";

const flat: FlattenedInventory = {
  facts: [
    {
      id: "exp_1",
      kind: "experience",
      text: "Senior Engineer at Northwind, 2019 to 2023. Cut checkout latency by 40 percent.",
      role: "Senior Engineer",
      company: "Northwind",
      start: "2019",
      end: "2023",
      tools: ["Postgres", "TypeScript"],
      numbers: ["40 percent"],
    } as never,
  ],
  numbers: ["40 percent"],
  tools: ["Postgres", "TypeScript"],
  roles: [],
} as unknown as FlattenedInventory;

function ctx(answer: string, over: Partial<RuleContext> = {}): RuleContext {
  return {
    answer,
    flat,
    violations: [],
    factIdsUsed: ["exp_1"],
    allowedFactIds: ["exp_1"],
    jobContextText: "",
    ...over,
  };
}

const CLEAN =
  "Checkout latency at Northwind dropped 40 percent after a rewrite of the payment path. " +
  "The old flow issued four sequential Postgres queries per page load. " +
  "I replaced them with one batched read and moved pricing into a cached view. " +
  "That work ran from 2019 to 2023 alongside the platform team. " +
  "Measuring each release against the previous week kept the change honest, and the pattern held once traffic doubled. " +
  "The same approach is what I would bring to this role, starting with whatever the slowest path turns out to be here today.";

describe("audit shape", () => {
  it("evaluates exactly 29 rules with unique ids", () => {
    expect(RULES).toHaveLength(TOTAL_RULES);
    expect(TOTAL_RULES).toBe(29);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(29);
  });

  it("returns a score for every rule and a 0-100 compliance score", () => {
    const a = auditAnswerRules(ctx(CLEAN));
    expect(a.rules).toHaveLength(29);
    expect(a.passedRules.length + a.failedRules.length).toBe(29);
    expect(a.complianceScore).toBeGreaterThanOrEqual(0);
    expect(a.complianceScore).toBeLessThanOrEqual(100);
    expect(a.version).toBe(RULE_AUDIT_VERSION);
    for (const r of a.rules) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(typeof r.reason).toBe("string");
    }
  });

  it("is deterministic across runs", () => {
    const a = auditAnswerRules(ctx(CLEAN));
    const b = auditAnswerRules(ctx(CLEAN));
    expect({ ...a, auditedAt: "" }).toEqual({ ...b, auditedAt: "" });
  });

  it("never calls the network", async () => {
    const spy = vi.spyOn(globalThis, "fetch" as never);
    auditAnswerRules(ctx(CLEAN));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("summary leaks no rule text", () => {
    const s = auditSummary(auditAnswerRules(ctx(CLEAN)));
    expect(Object.keys(s).sort()).toEqual([
      "complianceScore",
      "failed",
      "passed",
      "totalRules",
      "version",
    ]);
  });
});

describe("rule detection", () => {
  const failed = (answer: string, over?: Partial<RuleContext>) =>
    auditAnswerRules(ctx(answer, over)).failedRules;

  it("reports guard-detected violations as failed rules", () => {
    const f = failed("I led the migration at Northwind and it went well enough.", {
      violations: [{ code: "opens_with_i", detail: "starts with I", blocking: true } as never],
    });
    expect(f).toContain("rule_02_no_i_opening");
  });

  it("flags an em dash", () => {
    expect(failed(`${CLEAN} The result — measurable — held.`)).toContain("rule_12_no_em_dash");
  });

  it("flags hedging language", () => {
    expect(failed(`${CLEAN} I think it was arguably somewhat effective.`)).toContain("rule_09_no_hedging");
  });

  it("flags flattery about the company", () => {
    expect(
      failed("Your incredible mission is truly inspiring and I am passionate about it."),
    ).toContain("rule_10_no_flattery");
  });

  it("flags an exclamation mark", () => {
    expect(failed(`${CLEAN} It worked!`)).toContain("rule_13_no_rhetorical_or_exclamation");
  });

  it("flags a placeholder", () => {
    expect(failed(`${CLEAN} At [Company] the same applies.`)).toContain("rule_28_no_placeholders");
  });

  it("flags AI self-reference", () => {
    expect(failed("As an AI language model, this answer was generated for you.")).toContain(
      "rule_27_no_ai_self_reference",
    );
  });

  it("flags word count outside 90-170", () => {
    expect(failed("Too short.")).toContain("rule_24_word_count_in_range");
  });

  it("flags fact ids outside the allowed set", () => {
    expect(failed(CLEAN, { factIdsUsed: ["exp_9"] })).toContain("rule_25_fact_ids_reported");
  });

  it("passes a clean grounded answer on the core rules", () => {
    const f = failed(CLEAN);
    for (const id of [
      "rule_02_no_i_opening",
      "rule_09_no_hedging",
      "rule_10_no_flattery",
      "rule_12_no_em_dash",
      "rule_13_no_rhetorical_or_exclamation",
      "rule_14_no_lists_or_markdown",
      "rule_24_word_count_in_range",
      "rule_25_fact_ids_reported",
      "rule_27_no_ai_self_reference",
      "rule_28_no_placeholders",
    ]) {
      expect(f).not.toContain(id);
    }
  });
});
