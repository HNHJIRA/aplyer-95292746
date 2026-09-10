/**
 * Safety contract for the side panel's progressive answer rendering.
 *
 * The panel is a plain browser script driven by DOM ids, so these checks pin
 * the invariants that keep an unvalidated draft out of every final action:
 * the draft lives only in the running state and is cleared before an answer
 * is shown, and no action is bound to the live preview element.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const panel = readFileSync(resolve(process.cwd(), "extension/sidepanel.js"), "utf8");
const html = readFileSync(resolve(process.cwd(), "extension/sidepanel.html"), "utf8");
const bg = readFileSync(resolve(process.cwd(), "extension/background.js"), "utf8");

describe("side panel streaming safety", () => {
  it("has a dedicated read-only live answer element", () => {
    expect(html).toContain('id="answer-live"');
    // No button, copy or fill handler is wired to the live preview.
    expect(panel).not.toMatch(/answer-live"\)\s*\.addEventListener/);
  });

  it("renders the draft only while the run is still going", () => {
    const running = panel.slice(panel.indexOf('state.phase === "running"'));
    expect(running.slice(0, 400)).toContain("showLiveAnswer");
    // Final actions live on the answer card, which stays hidden while running.
    expect(running.slice(0, 400)).toContain("hideResults()");
  });

  it("clears the live preview before showing a validated answer or choice", () => {
    const show = panel.slice(panel.indexOf("function showAnswer"), panel.indexOf("function showChoice"));
    expect(show).toContain('showLiveAnswer("")');
    const choice = panel.slice(panel.indexOf("function showChoice"));
    expect(choice.slice(0, 300)).toContain('showLiveAnswer("")');
  });

  it("keeps the existing user-facing wording and hides internal terms", () => {
    expect(panel).toContain("Writing your answer…");
    expect(panel).toContain("Ready.");
    expect(panel.toLowerCase()).not.toContain("sse");
    expect(panel.toLowerCase()).not.toContain("claude");
  });

  it("stores the draft on the running state only, never as an answer", () => {
    const flush = bg.slice(bg.indexOf("const flushDraft"), bg.indexOf("let out = await requestStreamingAnswer"));
    expect(flush).toContain('phase: "running"');
    expect(flush).not.toContain("answer:");
  });

  it("falls back to the JSON request exactly once, with no draft carried over", () => {
    const fallback = bg.slice(bg.indexOf("if (out?.unsupported)"), bg.indexOf("let waits = 0"));
    expect(fallback).toContain('draft = ""');
    expect(fallback).toContain("requestValidatedAnswer(answerPayload)");
    expect(fallback.match(/requestValidatedAnswer\(/g)?.length).toBe(1);
  });
});
