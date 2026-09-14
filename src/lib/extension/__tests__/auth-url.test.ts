// Verifies the extension's user-facing auth navigation opens the production
// website (www.aplyer.ai) while the API origin is left untouched.
import { describe, expect, it } from "vitest";
import { AUTH_WEB_URL, APP_WEB_URL } from "@/lib/extension/runtime";

describe("extension auth destination", () => {
  it("opens sign-in on the production website", () => {
    expect(AUTH_WEB_URL).toBe("https://www.aplyer.ai");
  });

  it("does not point the auth page at the API origin", () => {
    expect(AUTH_WEB_URL).not.toContain("devssh");
  });

  it("keeps the backend API origin unchanged", () => {
    // APP_WEB_URL backs voicecard-api calls; it must NOT have been rewritten.
    expect(APP_WEB_URL).toBe("https://aplyer.devssh.xyz");
  });
});
