import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { BenefitsRow } from "../legacy-landing";

function mountBenefits() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<BenefitsRow />);
  });
  return {
    container,
    cleanup: () => {
      root.unmount();
      container.remove();
    },
  };
}

describe("Landing benefits section", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does not render the old 1,200+ statistic", () => {
    const { container, cleanup } = mountBenefits();
    expect(container.textContent).not.toContain("1,200+");
    cleanup();
  });

  it("does not render the old 62% statistic", () => {
    const { container, cleanup } = mountBenefits();
    expect(container.textContent).not.toContain("62%");
    cleanup();
  });

  it("does not render the old 3.4× statistic", () => {
    const { container, cleanup } = mountBenefits();
    expect(container.textContent).not.toContain("3.4×");
    cleanup();
  });

  it("does not render the old 100% statistic", () => {
    const { container, cleanup } = mountBenefits();
    expect(container.textContent).not.toContain("100%");
    cleanup();
  });

  it("renders all four new benefit statements", () => {
    const { container, cleanup } = mountBenefits();
    const text = container.textContent;
    expect(text).toContain("Answer open-ended questions faster");
    expect(text).toContain("Write answers grounded in your experience");
    expect(text).toContain("Apply with less repetitive typing");
    expect(text).toContain("Written in your voice, never a generic AI answer");
    cleanup();
  });

  it("renders four benefit cards", () => {
    const { container, cleanup } = mountBenefits();
    const cards = container.querySelectorAll("h3");
    expect(cards.length).toBe(4);
    cleanup();
  });
});
