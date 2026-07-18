import { describe, it, expect, beforeEach, vi } from "vitest";

// Backend state fixtures switched at runtime by tests.
const backend = {
  currentUserId: null as string | null,
  perUser: new Map<
    string,
    {
      profile: Record<string, unknown> | null;
      resume:
        | (Record<string, unknown> & { resume_scores?: Record<string, unknown>[] })
        | null;
      samples: Record<string, unknown>[];
      subscription: Record<string, unknown> | null;
      settings: Record<string, unknown> | null;
    }
  >(),
};

function currentBucket() {
  const uid = backend.currentUserId!;
  if (!backend.perUser.has(uid)) {
    backend.perUser.set(uid, {
      profile: null,
      resume: null,
      samples: [],
      subscription: null,
      settings: null,
    });
  }
  return backend.perUser.get(uid)!;
}

// Chainable query mock — supports .select().eq().order().limit().maybeSingle()
function makeQuery(resolve: () => unknown) {
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: resolve(), error: null }),
    then: (onFulfilled: any, onRejected: any) =>
      Promise.resolve({ data: resolve(), error: null }).then(onFulfilled, onRejected),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => {
  const supabase = {
    auth: {
      getUser: async () => ({
        data: {
          user: backend.currentUserId
            ? { id: backend.currentUserId, email: `${backend.currentUserId}@test.com` }
            : null,
        },
      }),
    },
    from(table: string) {
      const b = currentBucket();
      if (table === "profiles") return makeQuery(() => b.profile);
      if (table === "resumes") return makeQuery(() => b.resume);
      if (table === "writing_samples") return makeQuery(() => b.samples);
      if (table === "subscriptions") return makeQuery(() => b.subscription);
      if (table === "user_settings") return makeQuery(() => b.settings);
      return makeQuery(() => null);
    },
  };
  return { supabase };
});

import { hydrateFromBackend } from "@/lib/extension/sync";
import { storage } from "@/lib/storage/storage";
import { DEFAULT_STATE } from "@/lib/storage/types";

function seedUserA() {
  backend.perUser.set("user-a", {
    profile: {
      first_name: "Alice",
      last_name: "A",
      email: "a@test.com",
      phone: "",
      linkedin: "",
      portfolio: "",
      location: "NYC",
      writedna_stage: "strong",
      voice_confidence: 100,
      writing_sample_count: 2,
      qualifying_prose_count: 2,
      resume_uploaded: true,
      resume_only: false,
      voice_card_status: "generated",
      voice_card_data: { headline: "A voice" },
      voice_card_generated_at: "2026-01-01T00:00:00Z",
      voice_card_error: null,
      celebrated_strong: true,
      ab_demo_completed: true,
      ab_demo_answer: "v1",
      fallback_choice_completed: false,
      preferred_variant_id: "v1",
    },
    resume: {
      file_name: "alice.pdf",
      file_size: 100,
      file_type: "pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
      resume_text: "Alice resume",
      resume_scores: [
        {
          score: 85,
          completeness: 90,
          strength: 80,
          sections: {
            contact: true,
            experience: true,
            skills: true,
            education: true,
            summary: true,
            certifications: false,
          },
          strengths: [],
          suggestions: [],
        },
      ],
    },
    samples: [
      { id: "s1", type: "cover_letter", title: "t", content: "x", word_count: 100, created_at: "2026-01-01T00:00:00Z" },
      { id: "s2", type: "essay", title: "t2", content: "y", word_count: 100, created_at: "2026-01-01T00:00:00Z" },
    ],
    subscription: { tier: "free" },
    settings: null,
  });
}

function seedUserB() {
  backend.perUser.set("user-b", {
    profile: {
      first_name: "",
      last_name: "",
      email: "b@test.com",
      writedna_stage: "idle",
      voice_confidence: 0,
      writing_sample_count: 0,
      qualifying_prose_count: 0,
      resume_uploaded: false,
      resume_only: false,
      voice_card_status: "locked",
      voice_card_data: null,
      celebrated_strong: false,
      ab_demo_completed: false,
      ab_demo_answer: null,
    },
    resume: null,
    samples: [],
    subscription: null,
    settings: null,
  });
}

describe("hydrateFromBackend — account isolation & canonical routing", () => {
  beforeEach(async () => {
    localStorage.clear();
    await storage.reset();
    backend.perUser.clear();
    backend.currentUserId = null;
    seedUserA();
    seedUserB();
  });

  it("User A hydration populates User A data", async () => {
    backend.currentUserId = "user-a";
    const s = await hydrateFromBackend();
    expect(s?.activeUserId).toBe("user-a");
    expect(s?.profile?.firstName).toBe("Alice");
    expect(s?.resumeMetadata?.fileName).toBe("alice.pdf");
    expect(s?.writeDna.voiceCardStatus).toBe("generated");
    expect(s?.writingSamples.length).toBe(2);
  });

  it("switching UID to User B triggers reset and hydrates only B", async () => {
    backend.currentUserId = "user-a";
    await hydrateFromBackend();

    backend.currentUserId = "user-b";
    const s = await hydrateFromBackend();

    expect(s?.activeUserId).toBe("user-b");
    // No Alice leakage:
    expect(s?.profile?.firstName).toBe("");
    expect(s?.resumeMetadata).toBeNull();
    expect(s?.resumeText).toBeNull();
    expect(s?.resumeScore).toBeNull();
    expect(s?.writingSamples).toEqual([]);
    expect(s?.writeDna.voiceCard).toBeNull();
    expect(s?.writeDna.abDemoCompleted).toBe(false);
    expect(s?.writeDna.voiceCardStatus).toBe("locked");
  });

  it("switching back to User A rehydrates A", async () => {
    backend.currentUserId = "user-a";
    await hydrateFromBackend();
    backend.currentUserId = "user-b";
    await hydrateFromBackend();
    backend.currentUserId = "user-a";
    const s = await hydrateFromBackend();
    expect(s?.activeUserId).toBe("user-a");
    expect(s?.profile?.firstName).toBe("Alice");
    expect(s?.resumeMetadata?.fileName).toBe("alice.pdf");
  });

  it("missing resume clears cached resume fields explicitly", async () => {
    backend.currentUserId = "user-a";
    await hydrateFromBackend();
    // Simulate resume deletion server-side
    backend.perUser.get("user-a")!.resume = null;
    const s = await hydrateFromBackend();
    expect(s?.resumeMetadata).toBeNull();
    expect(s?.resumeText).toBeNull();
    expect(s?.resumeScore).toBeNull();
  });

  it("logout: reset() after hydration clears everything", async () => {
    backend.currentUserId = "user-a";
    await hydrateFromBackend();
    await storage.reset();
    const s = await storage.getState();
    expect(s).toEqual(DEFAULT_STATE);
    expect(s.activeUserId).toBeNull();
    expect(s.onboardingStatus.currentStep).toBe("welcome");
  });
});

describe("canonical routing derivation", () => {
  beforeEach(async () => {
    localStorage.clear();
    await storage.reset();
    backend.perUser.clear();
    backend.currentUserId = "u";
    backend.perUser.set("u", {
      profile: null,
      resume: null,
      samples: [],
      subscription: null,
      settings: null,
    });
  });

  const setProfile = (patch: Record<string, unknown>) => {
    const b = backend.perUser.get("u")!;
    b.profile = {
      first_name: "",
      last_name: "",
      email: "",
      writedna_stage: "idle",
      voice_confidence: 0,
      writing_sample_count: 0,
      qualifying_prose_count: 0,
      resume_uploaded: false,
      resume_only: false,
      voice_card_status: "locked",
      voice_card_data: null,
      celebrated_strong: false,
      ab_demo_completed: false,
      ab_demo_answer: null,
      ...patch,
    };
  };
  const setResume = () => {
    backend.perUser.get("u")!.resume = {
      file_name: "r.pdf",
      file_size: 1,
      file_type: "pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
      resume_text: "x",
      resume_scores: [],
    };
  };

  it("no resume -> resume_upload", async () => {
    setProfile({});
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("resume_upload");
  });

  it("resume, 0 samples -> writedna_progress (Building)", async () => {
    setResume();
    setProfile({ resume_uploaded: true, qualifying_prose_count: 0, voice_card_status: "locked" });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("writedna_progress");
  });

  it("1 sample -> writedna_progress (Good)", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 1,
      voice_card_status: "collecting_samples",
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("writedna_progress");
  });

  it("2 samples eligible -> voice_card", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 2,
      voice_card_status: "eligible",
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("voice_card");
  });

  it("generating -> voice_card", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 2,
      voice_card_status: "generating",
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("voice_card");
  });

  it("failed -> voice_card", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 2,
      voice_card_status: "failed",
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("voice_card");
  });

  it("stale -> voice_card", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 2,
      voice_card_status: "stale",
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("voice_card");
  });

  it("generated + A/B incomplete -> voice_card (AbDemo)", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 2,
      voice_card_status: "generated",
      ab_demo_completed: false,
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("voice_card");
  });

  it("generated + A/B complete + profile empty -> success (profile step retired)", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 2,
      voice_card_status: "generated",
      ab_demo_completed: true,
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("success");
  });

  it("generated + A/B complete + profile filled -> success (first hydration)", async () => {
    setResume();
    setProfile({
      first_name: "Alice",
      resume_uploaded: true,
      qualifying_prose_count: 2,
      voice_card_status: "generated",
      ab_demo_completed: true,
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("success");
  });

  it("resume-only path routes to success (no profile step)", async () => {
    setResume();
    setProfile({
      resume_uploaded: true,
      qualifying_prose_count: 0,
      resume_only: true,
      voice_card_status: "locked",
    });
    const s = await hydrateFromBackend();
    expect(s?.onboardingStatus.currentStep).toBe("success");
  });
});
