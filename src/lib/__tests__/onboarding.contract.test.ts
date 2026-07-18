import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const popupSrc = readFileSync(
  resolve(__dirname, "../../components/extension/PopupApp.tsx"),
  "utf8",
);
const typesSrc = readFileSync(
  resolve(__dirname, "../../lib/storage/types.ts"),
  "utf8",
);
const syncSrc = readFileSync(
  resolve(__dirname, "../../lib/extension/sync.ts"),
  "utf8",
);
const authSrc = readFileSync(
  resolve(__dirname, "../../routes/auth.tsx"),
  "utf8",
);

describe("Extension onboarding — profile removal & explicit completion", () => {
  it("OnboardingStep union no longer contains 'profile'", () => {
    const match = typesSrc.match(/export type OnboardingStep =[\s\S]*?;/);
    expect(match).toBeTruthy();
    expect(match![0]).not.toMatch(/"profile"/);
  });

  it("PopupApp does not import the deleted Profile screen", () => {
    expect(popupSrc).not.toMatch(/screens\/Profile"/);
  });

  it("PopupApp FLOW constant does not include 'profile'", () => {
    const flow = popupSrc.match(/const FLOW:[\s\S]*?\];/);
    expect(flow).toBeTruthy();
    expect(flow![0]).not.toMatch(/"profile"/);
  });

  it("deleted Profile screen file no longer exists", () => {
    expect(
      existsSync(resolve(__dirname, "../../components/extension/screens/Profile.tsx")),
    ).toBe(false);
  });

  it("PopupApp gates Dashboard behind explicit onboardingStatus.completed", () => {
    expect(popupSrc).toMatch(/state\.onboardingStatus\.completed[\s\S]{0,80}Dashboard/);
  });

  it("Success screen triggers markExtensionOnboardingComplete", () => {
    expect(popupSrc).toMatch(/markExtensionOnboardingComplete/);
  });

  it("sync exports markExtensionOnboardingComplete and writes the explicit flag", () => {
    expect(syncSrc).toMatch(/export async function markExtensionOnboardingComplete/);
    expect(syncSrc).toMatch(/extension_onboarding_completed/);
  });

  it("hydrateFromBackend never auto-completes onboarding from data alone", () => {
    // Completion MUST come from the explicit column, not from resume/AB heuristics.
    expect(syncSrc).toMatch(/explicitComplete/);
    expect(syncSrc).toMatch(/completed:\s*explicitComplete/);
  });

  it("sign-up form collects a phone number and sends it in raw metadata", () => {
    expect(authSrc).toMatch(/phone:\s*z\b[\s\S]*?\.string\(/);
    expect(authSrc).toMatch(/phone:\s*parsed\.data\.phone/);
    expect(authSrc).toMatch(/placeholder="Phone number/);
  });
});
