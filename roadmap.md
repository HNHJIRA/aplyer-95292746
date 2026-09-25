# Roadmap

- [x] Restore Brevo waitlist trigger unchanged and update only the direct welcome email wording.
- [x] Promote and verify real production streaming for Resume Audit and Resume Match.
- [x] Waitlist signup: instant confirmation after the required DB write, with durable retryable background jobs for contact sync and welcome email.
- [x] Part D: stop cross-visit reuse of completed demo comparisons (same-key idempotency kept).
- [ ] Part D demo controls: weekly reset of the per-email run count ("the count resets each week") — next separate task.
