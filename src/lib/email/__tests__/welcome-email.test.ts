import { describe, expect, it } from "vitest";
import {
  buildWelcomeEmailHtml,
  buildWelcomeEmailText,
  greetingFor,
} from "../welcome-email";

describe("welcome email", () => {
  it("falls back to a neutral greeting without a name", () => {
    expect(greetingFor(undefined)).toBe("Hi there,");
    expect(greetingFor("   ")).toBe("Hi there,");
    expect(greetingFor("<script>")).toBe("Hi there,");
  });

  it("uses only the first name", () => {
    expect(greetingFor("Miqdad Raza")).toBe("Hi Miqdad,");
  });

  it("escapes injected markup in the html body", () => {
    const html = buildWelcomeEmailHtml('Bob" onload="x');
    expect(html).not.toContain('onload="x');
  });

  it("includes all three lead magnets in html and text", () => {
    const html = buildWelcomeEmailHtml("Ann");
    const text = buildWelcomeEmailText("Ann");
    for (const body of [html, text]) {
      expect(body).toContain("Demo");
      expect(body).toContain("Red Flag Audit");
      expect(body).toContain("Resume Score");
      expect(body).toContain("WriteDNA");
    }
  });
});
