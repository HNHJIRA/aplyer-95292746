# Answer Pipeline (A → J) — Implementation Plan

One coordinated pipeline. Answer generation is never a standalone user-visible output: every generated answer must pass the quality scan before it reaches the side panel.

## 1. Backend flow

Single orchestrator (`src/lib/ai/answer-pipeline.server.ts`), one entry point `generateValidatedAnswer({ userId, question, jobContext?, supabase })`:

```text
question text (from extension)
  → Stage 1  classification (Opus, cached by question hash)      [existing]
  → Stage 2  requireReadyFactInventory(supabase, userId)          [only grounding gate]
  → Stage 3  Voice Card + WriteDNA context load (profiles row, server-side)
  → Stage 4  Prompt A  (claude-opus-4-6, temperature 0.3)
  → Stage 5  deterministic pre-scan (word count, No-I opening, hard-ban list)
  → Stage 6  Prompt J  (claude-opus-4-6, temperature 0)
  → Stage 7  correction loop (max 1 revision pass), then re-scan
  → Stage 8  persist + return validated answer only
```

Rules enforced in code, not just prompt text:
- Raw resume text is never read in this module. Stage 2 returns the canonical inventory; a flattened, evidence-bearing fact list is derived from it and is the only fact source given to A and J.
- No fact, framework, voice card, resume id or user id is ever accepted from the browser. Request body carries only `{ question, jobContext? }`.
- Voice Card must be in `generated` status. If it is `locked / collecting_samples / stale / failed`, the pipeline fails closed with a user-safe reason and no answer is produced.

## 2. Exact input contracts

Prompt A input (server-built only):
- `question` — verbatim detected question text (trimmed, capped 2000 chars)
- `framework` — from classification, server-side
- `frameworkStructure` — canonical structure string for that framework
- `voiceCard` — archetype, tone, cadence, formality, vocabulary bias (no raw samples)
- `facts[]` — flattened inventory entries `{ id, value, evidence, sourceSection, timeframe }`
- `jobContext?` — job title/description text if the page supplied it (context only, never a fact source)
- `wordRange` — `{ min: 90, max: 170 }`

Prompt A output contract: `{ answer: string, factIdsUsed: string[] }`. `factIdsUsed` must be a subset of supplied fact ids; any unknown id fails validation.

Prompt J input: `question`, `framework`, `answer`, `voiceCard`, the same `facts[]`, and `wordRange`. Output: `{ passed, checks[], blocking[], revisedAnswer|null, unsupportedSpans[] }`.

Prompt version bumps: A → `2.0.0` (temperature 0.3, 90–170 words, No-I / BLUF / Specificity Gate / hard-ban vocabulary / all 18 writing rules, fact-id contract). J → `2.0.0` (adds Check 11 and temporal-validity as explicit fail-closed checks, correction contract that only removes or rewrites, never substitutes a new fact).

## 3. Retry and fail-closed behaviour

- Both prompts run through the existing strict runner: pinned model, no fallback chain, one corrective retry on malformed JSON or contract violation, then hard failure.
- Fail closed (no answer shown) when: inventory not ready/stale, Voice Card not generated, classification fails, A fails twice, J fails twice, J still failing after the correction pass, Check 11 fails, any temporal-validity check fails, or the final answer falls outside 90–170 words.
- Provider errors are mapped to stable codes (`model_unavailable`, `rate_limited`, `not_configured`, `pipeline_failed`) and surfaced as plain user messages. No prompt names, model names, check numbers, or fact inventory content ever leave the server.

## 4. Prompt J correction loop

1. J scans the A output. If `passed`, done.
2. If not passed, J returns `revisedAnswer` produced under a strict repair contract: remove or rewrite only the unsupported/failing content, keep everything that is supported, never introduce a fact that is not in the inventory, stay inside 90–170 words.
3. The revised answer is re-scanned by J once (temperature 0).
4. If the re-scan passes → that is the final answer. If it fails → fail closed; nothing is shown.
5. Deterministic post-guard runs on the final text regardless of what J said: word count, No-I opening, hard-ban vocabulary, and a fact-token check that every number/date/employer/tool token in the answer appears in the inventory evidence. A post-guard failure fails closed too.

Maximum model calls per request: A ≤2, J ≤3 (initial scan, revision scan). No unbounded loops.

## 5. Persistence schema

New table `public.generated_answers` (server-write-only, same posture as the fact inventory):
- `user_id`, `resume_id`, `question_hash`, `question_text`, `framework`
- `answer_text`, `word_count`, `fact_ids_used[]`
- `quality_passed`, `quality_score`, `quality_blocking[]`, `revision_count`
- `prompt_a_version`, `prompt_j_version`, `model_a`, `model_j`, `inventory_source_hash`
- `status` (`generating | ready | failed`), `error`, `generation_id`, `generation_started_at`, `generated_at`, timestamps

Grants/RLS: `authenticated` gets `SELECT` on its own rows only; all writes go through the privileged server client. Unique key `(user_id, question_hash, inventory_source_hash, prompt_a_version, prompt_j_version)` gives cache reuse and idempotency.

## 6. Extension side-panel states

Single "Generate Answer" action, generic user-facing copy only:
1. `Checking this question…`
2. `Preparing your profile context…` (inventory not ready)
3. `Writing your answer…` (covers A, J, and the revision pass — no internal stages shown)
4. `Ready` — answer text, word count, Copy button, Regenerate
5. Blocked states with plain guidance: "Upload your resume first", "Add two writing samples to unlock your voice", "We couldn't produce an answer you can trust — try regenerating."

No confidence percentages, no check lists, no model or prompt names in the UI.

## 7. Idempotency and concurrency

- Cache key = question hash + inventory source hash + both prompt versions. A ready row is returned with zero model calls.
- Generation lock via `generation_id` + `generation_started_at`, same pattern as P0: a second concurrent request sees the in-flight run instead of duplicating it; locks older than 180s are treated as failed and retried.
- Commit only while the run still owns the lock; a newer run never gets overwritten.
- `Regenerate` sets `force`, bypasses the cache, and takes a fresh lock.

## 8. QA scenarios

Grounding and safety
- Answer containing an employer, tool, %, or team size absent from the inventory → blocked or scrubbed, never shown.
- Prompt A asked for facts it does not have → produces an honest shorter answer, or fails closed; never invents.
- Browser-supplied `facts`, `framework`, `resumeId`, `userId` in the request body → ignored entirely.
- Stale inventory (resume changed / model changed) → pipeline fails closed with the refresh path.

Quality gates
- Check 11 failure → fail closed even when every other check passes.
- Temporal-validity failure (invented month, wrong tense for a past role, "currently" on an ended role) → fail closed.
- J removes an unsupported claim and returns a supported-only rewrite → rewrite passes re-scan and is shown.
- Word count 89 or 171 after revision → fail closed.
- Answer opening with "I" → rejected by the deterministic post-guard.
- Hard-ban vocabulary present → rejected regardless of J's verdict.

Lifecycle and isolation
- Two tabs generating the same question concurrently → one model run, both get the same answer.
- Same question twice → second call is cache-served, zero model calls.
- User A can never read user B's answer row; authenticated writes are denied at the database level.
- Provider 429/503 → user sees a retry message, nothing is persisted as ready.

Out of scope for this phase: the 29-rule Human Score and autofill.
