import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import AuditResult from "./AuditResult";
import type { Audit } from "./types";

afterEach(cleanup);

const marcus: Audit = {
  promptVersion: "3.0.0",
  overallTake: "legacy paragraph that must not be shown alongside points",
  overallTakePoints: ["Strong senior scope.", "Timeline needs work."],
  redFlags: [
    {
      flag: "Unexplained short tenure",
      employer: "Mailchimp",
      whyPoints: ["Recruiters read short stints as risk.", "No context is given."],
      fixPoints: ["Add a one-line reason.", "Show impact delivered."],
      issue: "legacy issue",
      why: "legacy why",
      fix: "legacy fix",
    },
    {
      flag: "Vague ownership",
      employer: "Cox Communications",
      whyPoints: ["Did you design the program or run it?"],
      fixPoints: ["Name your role explicitly."],
      issue: "",
      why: "",
      fix: "",
    },
    {
      flag: "Dated tooling",
      employer: "Home Depot",
      whyPoints: ["Stack reads older than the target role."],
      fixPoints: ["Lead with current tooling."],
      issue: "",
      why: "",
      fix: "",
    },
  ],
  strengths: [{ point: "Clear promotion path across three employers." }, { point: "Quantified revenue impact." }],
  strengthsText: ["legacy strength text"],
  topPriority: "Fix the Mailchimp tenure gap first.",
  closing: "You are close. Tighten the timeline story.",
};

describe("AuditResult", () => {
  it("renders each red flag as its own card", () => {
    render(<AuditResult audit={marcus} />);
    expect(screen.getAllByTestId("red-flag-card")).toHaveLength(3);
  });

  it("preserves backend red flag ordering", () => {
    render(<AuditResult audit={marcus} />);
    const employers = screen
      .getAllByTestId("red-flag-card")
      .map((c) => c.textContent ?? "");
    expect(employers[0]).toContain("Mailchimp");
    expect(employers[1]).toContain("Cox Communications");
    expect(employers[2]).toContain("Home Depot");
  });

  it("renders whyPoints and fixPoints as bullet lists", () => {
    render(<AuditResult audit={marcus} />);
    const first = screen.getAllByTestId("red-flag-card")[0];
    const why = within(first).getByTestId("why-points");
    const fix = within(first).getByTestId("fix-points");
    expect(why.tagName).toBe("UL");
    expect(within(why).getAllByRole("listitem")).toHaveLength(2);
    expect(within(fix).getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders strengths as separate green cards from the canonical field", () => {
    render(<AuditResult audit={marcus} />);
    const cards = screen.getAllByTestId("strength-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("Clear promotion path across three employers.");
    expect(screen.queryByText(/legacy strength text/)).toBeNull();
  });

  it("renders overallTakePoints as bullets and hides the legacy paragraph", () => {
    render(<AuditResult audit={marcus} />);
    const list = screen.getByTestId("overall-take-points");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/legacy paragraph/)).toBeNull();
  });

  it("displays candidate-facing wording unchanged", () => {
    render(<AuditResult audit={marcus} />);
    expect(screen.getByText("Did you design the program or run it?")).toBeTruthy();
  });

  it("falls back to legacy fields when canonical ones are missing", () => {
    const legacy: Audit = {
      verdict: "Solid but unfocused.",
      redFlags: [{ issue: "Old issue", why: "Old why", fix: "Old fix" }],
      strengthsText: ["Legacy strength"],
      closing: "Done.",
    };
    render(<AuditResult audit={legacy} />);
    expect(screen.getByText("Old issue")).toBeTruthy();
    expect(screen.getByText("Old why")).toBeTruthy();
    expect(screen.getByText("Old fix")).toBeTruthy();
    expect(screen.getAllByTestId("strength-card")).toHaveLength(1);
    expect(screen.getByText("Solid but unfocused.")).toBeTruthy();
  });

  it("handles empty arrays safely", () => {
    render(<AuditResult audit={{ redFlags: [], strengths: [], overallTakePoints: [] }} />);
    expect(screen.queryByTestId("red-flag-card")).toBeNull();
    expect(screen.queryByTestId("strength-card")).toBeNull();
    expect(screen.queryByTestId("overall-take")).toBeNull();
  });

  it("does not render strength text as one combined paragraph", () => {
    const jennifer: Audit = {
      redFlags: [],
      strengths: [{ point: "A" }, { point: "B" }, { point: "C" }],
    };
    render(<AuditResult audit={jennifer} />);
    const cards = screen.getAllByTestId("strength-card");
    expect(cards).toHaveLength(3);
    cards.forEach((c) => expect(within(c).getAllByRole("paragraph").length).toBe(1));
  });
});
