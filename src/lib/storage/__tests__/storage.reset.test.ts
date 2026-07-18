import { describe, it, expect, beforeEach } from "vitest";
import { storage } from "@/lib/storage/storage";
import { DEFAULT_STATE } from "@/lib/storage/types";

describe("storage reset / logout hygiene", () => {
  beforeEach(async () => {
    localStorage.clear();
    await storage.reset();
  });

  it("returns DEFAULT_STATE when empty", async () => {
    const s = await storage.getState();
    expect(s).toEqual(DEFAULT_STATE);
    expect(s.activeUserId).toBeNull();
  });

  it("reset() clears aplyer.v1 (logout)", async () => {
    await storage.patch({
      activeUserId: "user-a",
      resumeText: "hello",
      profile: {
        firstName: "A",
        lastName: "A",
        email: "a@a.com",
        phone: "",
        linkedin: "",
        portfolio: "",
        location: "",
      },
    });
    let s = await storage.getState();
    expect(s.activeUserId).toBe("user-a");
    expect(s.resumeText).toBe("hello");

    await storage.reset();
    s = await storage.getState();
    expect(s).toEqual(DEFAULT_STATE);
    expect(s.activeUserId).toBeNull();
    expect(s.resumeText).toBeNull();
    expect(s.profile).toBeNull();
    expect(s.writingSamples).toEqual([]);
    expect(s.writeDna.voiceCard).toBeNull();
    expect(s.writeDna.abDemoCompleted).toBe(false);
    expect(s.onboardingStatus.currentStep).toBe("welcome");
  });
});
