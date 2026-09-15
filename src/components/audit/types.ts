export interface RedFlag {
  /** canonical (v3.0.0) */
  flag?: string;
  whyPoints?: string[];
  fixPoints?: string[];
  employer?: string | null;
  /** legacy fallbacks */
  issue?: string;
  why?: string;
  fix?: string;
}

export interface Strength {
  point: string;
}

export interface Audit {
  overallTake?: string;
  overallTakePoints?: string[];
  redFlags?: RedFlag[];
  /** canonical */
  strengths?: Array<Strength | string>;
  /** legacy */
  strengthsText?: string[];
  topPriority?: string;
  verdict?: string;
  closing?: string;
  promptVersion?: string;
}

/** Canonical wins; legacy strings only used when canonical is absent. */
export function strengthPoints(audit: Audit): string[] {
  const canonical = (audit.strengths ?? [])
    .map((s) => (typeof s === "string" ? s : s?.point))
    .filter((s): s is string => Boolean(s && s.trim()));
  if (canonical.length) return canonical;
  return (audit.strengthsText ?? []).filter((s) => Boolean(s && s.trim()));
}

export function redFlagTitle(rf: RedFlag): string {
  return (rf.flag && rf.flag.trim()) || (rf.issue ?? "").trim();
}

export function whyList(rf: RedFlag): string[] {
  const pts = (rf.whyPoints ?? []).filter((p) => Boolean(p && p.trim()));
  if (pts.length) return pts;
  return rf.why && rf.why.trim() ? [rf.why] : [];
}

export function fixList(rf: RedFlag): string[] {
  const pts = (rf.fixPoints ?? []).filter((p) => Boolean(p && p.trim()));
  if (pts.length) return pts;
  return rf.fix && rf.fix.trim() ? [rf.fix] : [];
}

/**
 * Guarantees the completed result carries an overall take. The validated final
 * payload always wins; the text streamed during generation is used only when
 * the final payload has none, so it is never silently dropped.
 */
export function mergeStreamedOverallTake(audit: Audit, streamed: string): Audit {
  const existing = overallTakeList(audit);
  if (existing.points.length || existing.text) return audit;
  const text = (streamed ?? "").trim();
  return text ? { ...audit, overallTake: text } : audit;
}

/** Structured bullets preferred; the prose paragraph is a fallback only. */
export function overallTakeList(audit: Audit): { points: string[]; text: string | null } {
  const points = (audit.overallTakePoints ?? []).filter((p) => Boolean(p && p.trim()));
  if (points.length) return { points, text: null };
  const text = audit.overallTake || audit.verdict || null;
  return { points: [], text: text && text.trim() ? text : null };
}
