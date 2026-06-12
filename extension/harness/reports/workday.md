# Workday Adapter — Fixture-Based Validation Report

**Kind:** Fixture-based validation (NOT live-tenant validation)
**Adapter:** `WorkdayAdapter` v1.0.0 (Adapter API 1.1.0, Orchestrator 1.2.0)
**Runner:** `node extension/harness/run-workday-harness.mjs`
**Latest run:** 9 / 9 fixtures passed.

## Scope and limitations

This harness loads `extension/content/adapters/workday.js` (plus base + injector + logger) into a `jsdom` window and asserts behaviour against hand-authored Workday-shaped DOM snippets. Each snippet was constructed from publicly visible patterns in Workday's apply flow (`data-automation-id` wrappers, `formField-*` naming, `richText*` content-editables, `aria-labelledby` chains, wizard `*Section`/`*Panel` containers).

**What this proves:** The adapter's stable-id resolution, label proximity heuristics, multi-step section discovery, and duplicate-injection guards behave correctly against the documented Workday DOM contract.

**What this does NOT prove:** That a particular live tenant's exact markup is covered. Real tenants vary in label wiring, custom field types, embedded iframes, and SSO-gated flows. Live coverage requires the in-page diagnostics overlay (see `docs/live-qa.md`).

## Test cases

| ID    | Scenario                                                          | Result |
| ----- | ----------------------------------------------------------------- | ------ |
| WD-01 | Standard textarea inside `formField-*` wrapper, inline label       | PASS   |
| WD-02 | Rich-text `contenteditable` answer (`richText*` automation id)     | PASS   |
| WD-03 | `aria-labelledby` chain resolves the question text                  | PASS   |
| WD-04 | Validation re-render — stable id survives inner textarea replace   | PASS   |
| WD-05 | Save & Continue — section subtree remount preserves stable id      | PASS   |
| WD-06 | Multi-step wizard — two `*Section` panels yield two questions      | PASS   |
| WD-07 | Hidden inline label — fallback to `aria-label`                      | PASS   |
| WD-08 | Disabled textarea ignored                                           | PASS   |
| WD-09 | Repeated `extractQuestions()` does not double-emit                  | PASS   |

Machine-readable results: `extension/harness/reports/workday.json`.

## Coverage summary

| Capability                          | Covered by | Status |
| ----------------------------------- | ---------- | ------ |
| `matches()` (host + DOM signature)  | adapter unit | implicit |
| `resolveStableId()` — automation-id  | WD-01, WD-02, WD-03 | PASS |
| `resolveStableId()` — wrapper walk   | WD-04, WD-05 | PASS |
| `proximityLabel()` — `<label>`       | WD-01 | PASS |
| `proximityLabel()` — `aria-labelledby` | WD-03 | PASS |
| `proximityLabel()` — `aria-label`    | WD-07 | PASS |
| `mapFormStructure()` — sections      | WD-06 | PASS |
| `extractQuestions()` — textarea      | WD-01, WD-04, WD-05 | PASS |
| `extractQuestions()` — contenteditable | WD-02 | PASS |
| `extractQuestions()` — disabled skip | WD-08 | PASS |
| Injection idempotency (re-scan)      | WD-09 | PASS |
| Re-injection after DOM mutation      | WD-04, WD-05 | PASS |

## Known limitations (not yet covered)

1. **iframe-embedded apply flows.** Some Workday tenants embed the apply form inside a same-origin iframe; the manifest enables `all_frames: true` so injection should still run, but no fixture exercises a cross-frame DOM yet.
2. **Bot protection (Cloudflare/Imperva + reCAPTCHA).** Cannot be reproduced in jsdom; verify via the live-QA overlay.
3. **Locale variants.** Labels in non-English locales are not in the fixture set. The proximity heuristics are language-agnostic, but visual confirmation is required.
4. **Custom field types** (date pickers, multi-select widgets that synthesize textareas, file uploaders with attached comment fields). Only essay-bearing fields are in scope for M3.
5. **Tenants that strip `data-automation-id` attributes.** The DOM-signature fallback in `matches()` covers detection, but `resolveStableId()` then falls back to `id`/`name`, which Workday re-shuffles. Expected failure mode — documented for M4.

## Reproducing

```bash
node extension/harness/run-workday-harness.mjs
```

Exit code is `0` when all fixtures pass, `1` otherwise. CI-safe.
