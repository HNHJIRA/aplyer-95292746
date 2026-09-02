// Deterministic 29-rule audit of a FINAL, already-validated answer.
//
// Position in the flow:
//   Question -> Prompt A -> Prompt J -> final answer -> 29 Rule Audit -> display
//
// The audit never blocks an answer and never calls a model. It is evidence,
// stored per answer, that the generation rules were enforced.
import { RULES, RULE_AUDIT_VERSION, TOTAL_RULES, type RuleContext, type RuleResult } from "./rules";

export interface AnswerRuleAudit {
  version: string;
  totalRules: number;
  passedRules: string[];
  failedRules: string[];
  complianceScore: number;
  rules: RuleResult[];
  auditedAt: string;
}

export function auditAnswerRules(ctx: RuleContext): AnswerRuleAudit {
  const rules: RuleResult[] = RULES.map((rule) => {
    let outcome: { passed: boolean; score?: number; reason: string };
    try {
      outcome = rule.evaluate(ctx);
    } catch (e) {
      // A rule that throws is reported as a failure with its own reason —
      // it never takes the pipeline down.
      outcome = { passed: false, reason: `rule error: ${String(e).slice(0, 120)}` };
    }
    const score =
      typeof outcome.score === "number"
        ? Math.max(0, Math.min(100, Math.round(outcome.score)))
        : outcome.passed
          ? 100
          : 0;
    return {
      ruleId: rule.id,
      title: rule.title,
      passed: outcome.passed,
      score,
      reason: outcome.reason,
    };
  });

  const passedRules = rules.filter((r) => r.passed).map((r) => r.ruleId);
  const failedRules = rules.filter((r) => !r.passed).map((r) => r.ruleId);
  const complianceScore = Math.round(rules.reduce((a, r) => a + r.score, 0) / rules.length);

  return {
    version: RULE_AUDIT_VERSION,
    totalRules: TOTAL_RULES,
    passedRules,
    failedRules,
    complianceScore,
    rules,
    auditedAt: new Date().toISOString(),
  };
}

/** Compact summary safe to return to any caller (no rule text, no reasons). */
export function auditSummary(audit: AnswerRuleAudit) {
  return {
    version: audit.version,
    totalRules: audit.totalRules,
    passed: audit.passedRules.length,
    failed: audit.failedRules.length,
    complianceScore: audit.complianceScore,
  };
}
