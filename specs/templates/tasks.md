# Tasks — <Feature name>

- **ID:** NNN-<slug>
- **Plan reference:** `./plan.md`
- **Status:** todo | in-progress | done | blocked

Task format: `[ ]` open, `[x]` done, `[~]` in progress, `[!]` blocked. Keep tasks small and verifiable. Group by phase.

---

## Phase 1 — Data & backend

- [ ] **T1.1** — Add migration `NNN_<feature>_<subject>.sql` with tables and RLS policies from `plan.md#modelo-de-datos`. _DoD: migration runs cleanly on a fresh DB; RLS enabled on every new table._
- [ ] **T1.2** — Seed script for local/dev fixtures relevant to this feature. _DoD: `npm run seed` populates the new tables._
- [ ] **T1.3** — Types generated from Supabase schema (`supabase gen types`). _DoD: `types/database.ts` updated and committed._

## Phase 2 — API

- [ ] **T2.1** — Implement route `<METHOD> <path>`. _DoD: happy path + auth check + input validation._
- [ ] **T2.2** — Zod schemas for request/response payloads. _DoD: schemas colocated with route; exported for reuse._

## Phase 3 — UI

- [ ] **T3.1** — Component `<Name>` — <responsibility>. _DoD: renders loading/empty/error states._
- [ ] **T3.2** — Wire component to API/route. _DoD: no `any`; error boundaries in place._

## Phase 4 — Tests

- [ ] **T4.1** — Unit tests for business logic (pure functions). _DoD: cover happy path + at least 2 edge cases per rule._
- [ ] **T4.2** — Integration tests hitting a real (test) Supabase instance for RLS-sensitive logic. _DoD: policies verified with allowed and denied actors._
- [ ] **T4.3** — E2E test for the critical user flow. _DoD: Playwright test passes locally and in CI._

## Phase 5 — Docs & handoff

- [ ] **T5.1** — Update `CLAUDE.md` if new conventions were introduced.
- [ ] **T5.2** — Add ADR under `docs/adr/` for any non-obvious decision made during implementation.
- [ ] **T5.3** — Update `specs/features/README.md` — mark feature `done`.

---

## Blocked / follow-ups

Track anything discovered mid-implementation that doesn't belong in this feature.

- [ ] **F1** — <follow-up>. Owner: <name>. Where it lives next: <ticket/spec>.
