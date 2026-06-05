import type { ResumeScore } from "../storage/types";

const SECTION_PATTERNS = {
  contact: /(email|@|phone|\+\d|linkedin\.com|github\.com)/i,
  experience: /\b(experience|employment|work history|professional background)\b/i,
  skills: /\b(skills|technologies|technical skills|tools)\b/i,
  education: /\b(education|university|college|bachelor|master|degree)\b/i,
  summary: /\b(summary|profile|objective|about me)\b/i,
  certifications: /\b(certification|certificate|certified|license)\b/i,
};

/**
 * Local, deterministic resume readiness score. No AI, no APIs.
 */
export function scoreResume(text: string): ResumeScore {
  const t = text || "";
  const lower = t.toLowerCase();
  const length = t.length;

  const sections = {
    contact: SECTION_PATTERNS.contact.test(lower),
    experience: SECTION_PATTERNS.experience.test(lower),
    skills: SECTION_PATTERNS.skills.test(lower),
    education: SECTION_PATTERNS.education.test(lower),
    summary: SECTION_PATTERNS.summary.test(lower),
    certifications: SECTION_PATTERNS.certifications.test(lower),
  };

  // weighted score
  const weights = { contact: 18, experience: 22, skills: 16, education: 14, summary: 10, certifications: 8 };
  let score = 0;
  (Object.keys(weights) as (keyof typeof weights)[]).forEach((k) => {
    if (sections[k]) score += weights[k];
  });

  // length bonus (up to 12)
  const lengthBonus = Math.max(0, Math.min(12, Math.floor(length / 600)));
  score += lengthBonus;

  // quantifiable achievements bonus (numbers/percentages)
  const numbers = (lower.match(/\b\d{2,}%?\b/g) || []).length;
  const quantBonus = Math.min(8, numbers);
  score += quantBonus;

  score = Math.max(8, Math.min(100, score));

  const strengthsList: string[] = [];
  if (sections.contact) strengthsList.push("Contact Information");
  if (sections.experience) strengthsList.push("Experience");
  if (sections.skills) strengthsList.push("Skills");
  if (sections.education) strengthsList.push("Education");
  if (sections.summary) strengthsList.push("Professional Summary");
  if (sections.certifications) strengthsList.push("Certifications");

  const suggestions: string[] = [];
  if (!sections.certifications) suggestions.push("Add Certifications or Licenses");
  if (!sections.summary) suggestions.push("Add a Professional Summary");
  if (quantBonus < 4) suggestions.push("Add More Quantifiable Achievements");
  if (!/portfolio|github\.com|behance|dribbble/.test(lower)) suggestions.push("Add a Portfolio or GitHub Link");
  if (length < 1200) suggestions.push("Expand on Role Responsibilities");
  if (suggestions.length === 0) suggestions.push("Tailor your resume per role for best results");

  const sectionsCount = Object.values(sections).filter(Boolean).length;
  const completeness = Math.round((sectionsCount / 6) * 100);
  const readiness = Math.min(100, Math.round(score * 0.6 + completeness * 0.4));
  const strength = Math.min(100, Math.round(score * 0.7 + quantBonus * 4));

  return { score, strengths: strengthsList, suggestions, sections, completeness, readiness, strength };
}
