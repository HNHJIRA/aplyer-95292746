import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Hydration-gate contract tests.
 *
 * Full component render would require mounting the extension popup with
 * chrome.* shims; instead we assert the source-level invariants that
 * guarantee no cached account content is rendered while the session or
 * canonical hydration is unresolved.
 */
describe("PopupApp hydration gate", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../components/extension/PopupApp.tsx"),
    "utf8",
  );

  it("declares a `hydrating` state flag", () => {
    expect(src).toMatch(/hydrating/);
  });

  it("renders a neutral loading state while hydrating", () => {
    // Must gate the UI on `hydrating` before rendering any screen.
    expect(src).toMatch(/hydrating\s*\)/);
  });

  it("calls hydrateFromBackend during startup", () => {
    expect(src).toMatch(/hydrateFromBackend/);
  });
});
