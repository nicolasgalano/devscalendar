# Tasks — Registered debt cleanup

- **ID:** 013-registered-debt-cleanup
- **Plan reference:** `./plan.md`
- **Status:** done el 2026-09-08, salvo T4.5 (revisión visual de los cuatro Select, necesita ojos humanos)

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **The one decision worth not getting wrong is where D-08's check goes.**
> `can_manage_booking()` is shared by the insert policy, the update policy and
> `reallocate_booking()`, so putting it there would also freeze cancelling and
> editing the bookings of a deactivated project — which is precisely what its PM
> needs to do after deactivating it. It goes in the **insert** policy. See
> `plan.md` §2.2 and AC-4.2.

---

## Phase 1 — Migration

- [x] **T1.1** — `00000000000010_debt_cleanup.sql`: recreate
      `clients: authenticated read` and `projects: authenticated read` with
      `has_any_role()`. _DoD: T4.2 covers the three actors._
- [x] **T1.2** — Recreate `bookings: manager insert` with the active-project
      condition. `bookings: manager update` stays untouched. _DoD: T4.3._
- [x] **T1.3** — `pnpm db:push` and `pnpm db:types`. No schema change expected;
      run it anyway to confirm.

## Phase 2 — Code

- [x] **T2.1** — D-05: `readJsonBody()` in the six handlers of `002`.
      _DoD: a malformed body answers 400, not 500._
- [x] **T2.2** — D-08: the `POST /api/bookings` handler checks the project is
      active and answers 400, the same way it already does for the developer.
- [x] **T2.3** — D-03: pure ordering function plus `primary_pm_id` in the
      `getBookingOptions()` select. Admins are not reordered. _DoD: T4.1._
- [x] **T2.4** — D-03: drop the "PM primario" column from the `/admin/users`
      table — header and cell. The field stays in the edit dialog.
- [x] **T2.5** — D-04: resolve the label by hand inside the four remaining
      `<SelectValue>` — primary PM, client, responsible PM, priority.

## Phase 3 — Docs

- [x] **T3.1** — D-02: record the AC-1.3 deviation in `001/spec.md`.

## Phase 4 — Tests

- [x] **T4.1** — Unit for the ordering: PM with their own devs, PM with none,
      admin. _DoD: no developer disappears in any of the three._
- [x] **T4.2** — Integration for F7: with a role, with no role, deactivated —
      over `clients` and `projects`, **reading the rows back**.
- [x] **T4.3** — Integration for D-08: insert on a deactivated project affects
      zero rows; cancelling an existing booking of that same project works.
- [x] **T4.4** — E2E that shrinks D-06: a PM bounces off `/admin/users` and
      `/admin/projects` and gets 403 from the three admin handlers.
- [ ] **T4.5** — Visual review of the four fixed `<SelectValue>` triggers.
      **Needs human eyes:** that a trigger shows the right label is precisely
      what a text assertion cannot tell you without rendering the screen.

## Phase 5 — Debt bookkeeping

- [x] **T5.1** — `docs/deuda-tecnica.md`: close D-02, D-03, D-04, D-05, D-08.
      D-06 stays open with only its manual half.
- [x] **T5.2** — Close F7 in `003/tasks.md`, and the D-0x entries repeated in the
      `tasks.md` of `001`, `002` and `004`.
- [x] **T5.3** — `CLAUDE.md` and `specs/features/README.md`: the debt count, and
      the new read rule for the masters.

---

## Blocked / follow-ups

- [ ] **F1** — **D-06 keeps its manual half and nothing can take it away.** The
      E2E fixtures plant the session cookie directly (`tests/e2e/session.ts`),
      never going through Google OAuth, so "a real person logs in and sees what
      they should" is not something this suite can answer.
- [ ] **F2** — **The `authenticated read` policies now lie in their name.** They
      require a role, not merely being authenticated. Renaming them means
      touching three migrations and the tests for zero behaviour, so the comment
      in `…0010` carries the truth instead.
