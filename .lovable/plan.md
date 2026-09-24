# Section A implementation plan

## Scope
Implement only A1–A12 from the September 23 specification. Preserve the existing demo, answer, Voice Card, extension, retry, cache, and fail-closed flows. Do not deploy or begin later sections.

## Changes
1. **Model corrections**
   - Pin P0 to central `MODEL_OPUS` and update its contract assertion.
   - Keep `/demo` on `/api/public/demo`; verify P0, Prompt A, and Prompt J are all Opus.
   - Keep Voice Card generation on Haiku, while assigning central `MODEL_OPUS` only to both A/B answer implementations and their stored model metadata.
   - Remove the unused legacy AI helper after a final repository-wide reference check.

2. **Safety and language corrections**
   - Replace trusted-host “Safe / 100% Genuine” output with a neutral, scoreless result while preserving the extension-to-API request chain.
   - Update affected types, tests, and side-panel rendering without inventing a replacement score.
   - Add all six missing exact hard-banned words while retaining every existing term and phrase.

3. **Candidate-facing settings and privacy copy**
   - Remove the extension’s provider picker, candidate-controlled provider state, obsolete plan list, Enterprise copy, and “Advanced AI providers.”
   - Remove inaccurate local-only resume claims and use factual wording limited to current behavior.
   - Remove candidate-visible model/vendor references from Voice Card and WriteDNA surfaces.

4. **Candidate-facing terminology cleanup**
   - Remove visible em/en dashes from active app, public, legacy demo, and extension copy while leaving internal comments, identifiers, and stylometry character detection intact.
   - Replace the specified Resume Analysis sentence exactly and neutralize unsupported ATS simulation/scoring claims in Resume Match.
   - Standardize visible feature branding to `WriteDNA` without renaming files, fields, routes, variables, or internal prompt language.

## Verification
- Search for stale Section A model pins, safety certification copy, provider/pricing UI, local-only resume claims, visible model/vendor names, unsupported ATS claims, dash characters, and WriteDNA variants.
- Run the complete test suite, typecheck, and production build.
- Perform browser checks on the changed public pages and available authenticated/extension-facing surfaces using safe local state only.
- Report A1–A12 status, changed files, exact verification results, internal-only remaining dash occurrences, and any unresolved specification gaps.
