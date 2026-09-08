# Tasks — Multiple roles and active enforcement

- **ID:** 012-multiple-roles-and-active-enforcement
- **Plan reference:** `./plan.md`
- **Status:** done el 2026-09-08

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Read `plan.md` §3.3 before writing the migration.** Nine policies have to be
> recreated, and the list is there so the review has something to compare
> against. Postgres refuses to drop a function policies depend on, so a forgotten
> one fails the migration instead of leaving a hole — but only if every policy
> that reads `role` directly is on the list too, and two of them do.

> **And read `plan.md` §11 before `db:push`.** This migration drops the column
> the deployed code reads. The order is not negotiable: `db:push` → `db:types` →
> code → CI → push to `main`. There is a window with the site broken, and it is
> acceptable **only** because nobody uses the app yet.

---

## Phase 0 — Before starting

- [x] **T0.1** — Q-A and Q-6 answered (2026-09-07). They were D-09's only product
      prerequisites: one PM per project, no Client role. Without them this
      feature could not start.
- [x] **T0.2** — Decide whether **D-07** rides along. Its own entry says it is
      settled together with D-01, and it is one line in the same `select` of
      `api/bookings/[id]/route.ts`. **The user said yes on 2026-09-08**, so it is
      in: leaving it out would have closed D-01 with the same hole one file
      over — you could not _create_ a booking for a deactivated developer but
      you could _move_ one onto them. **D-08 stays out** and keeps its own entry.

## Phase 1 — Database

- [x] **T1.1** — Migration `00000000000009_multiple_roles_and_active.sql`,
      sections in the order of `plan.md` §3.6. _DoD: `supabase db reset --local`
      runs it clean on a fresh database in CI._
- [x] **T1.2** — `roles` column on `profiles` and `profile_invites`, backfilled
      from `role`, plus the normalising trigger (sorted, deduped). _DoD: a fresh
      DB seeded from `seed.sql` has the same effective roles it has today._
- [x] **T1.3** — `has_role()` and `has_any_role()`, both `security definer` with
      `set search_path`, both including `and active`. `revoke all from public` +
      `grant execute to authenticated`. _DoD: the D-01 checks of T4.2 pass._
- [x] **T1.4** — Recreate the nine policies of `plan.md` §3.3. _DoD: the table in
      §3.3 and the migration say the same thing, row by row._
- [x] **T1.5** — `create or replace` for `can_manage_booking()`,
      `reallocate_booking()` and `handle_new_user()`. _DoD: the nine existing
      reallocation integration tests still pass untouched._
- [x] **T1.6** — Drop `current_user_role()`, drop both `role` columns, swap the
      partial index for a GIN on `roles`.
- [x] **T1.7** — Update `supabase/seed.sql` to write `roles`. _DoD: `db:seed` is
      still idempotent._
- [x] **T1.8** — `pnpm db:push` then `pnpm db:types`. _DoD: `src/types/database.ts`
      regenerated; compare with `diff --strip-trailing-cr` (the working tree is
      CRLF and the generator writes LF — the lesson from `006` T1.4)._

## Phase 2 — Pure logic and guards

- [x] **T2.1** — New `src/lib/auth/roles.ts`: `hasRole`, `isAdmin`, `canBePm`,
      `ROLE_LABEL`, `formatRoles`. No Supabase import. _DoD: covered by T4.1._
- [x] **T2.2** — `getCurrentProfile()` selects `roles` instead of `role`.
- [x] **T2.3** — The three guards in `src/lib/api/` check membership **and**
      `active`. `requireAdmin()` stops selecting only `role`. _DoD: AC-3.1._
- [x] **T2.4** — `permissions.ts`: `BookingViewer.roles`, and `canManageProject`
      / `canCreateBookings` by membership. _DoD: T4.1 covers a `pm+admin`._
- [x] **T2.5** — `validation/users.ts`: `roles` array, `min(1)`. _DoD: AC-1.4
      returns 400, not 500._
- [x] **T2.6** — The five `.eq("role", …)` become `.contains("roles", [...])`:
      `options.ts:53`, `calendar/query.ts:340`, `admin/projects/page.tsx:21`,
      `admin/users/page.tsx:19`, and the dev lookup in `api/bookings/route.ts`.
      _DoD: T4.4, because a bad filter typechecks fine._
- [x] **T2.7** — The role comparisons in the handlers (`!== "pm"`,
      `!== "developer"`) become membership questions.

## Phase 3 — UI

- [x] **T3.1** — `AppShell` takes `roles` and builds the nav by union. _DoD:
      AC-4.1 — a `developer+admin` sees both the inbox and the admin section._
- [x] **T3.2** — The three role gates (`(app)/layout`, `admin/layout`,
      `inbox/layout`) ask about membership. _DoD: AC-2.2 and AC-2.4._
- [x] **T3.3** — `/admin/users`: the role `Select` becomes three checkboxes in
      both dialogs; save is disabled with none ticked and says why. _DoD:
      AC-1.1, AC-1.4._
- [x] **T3.4** — The Rol column lists every role as badges, `Sin rol` in italics
      when empty. _DoD: AC-1.2 — never the raw DB value._
- [x] **T3.5** — The two PM dropdowns stop filtering `role = 'pm'` exactly.
      _DoD: AC-2.1, AC-2.3._

## Phase 4 — Tests

- [x] **T4.1** — Unit: `roles.ts` in full, plus `permissions.ts` with one-role
      and two-role viewers. _DoD: a `pm+admin` manages another PM's project; a
      plain `pm` does not._
- [x] **T4.2** — Integration: the seven scenarios of `plan.md` §10, **every one
      reading the row back with `service_role`**. Checking the error code cannot
      tell "it worked" from "RLS filtered it in silence". _DoD: AC-3.1 to
      AC-3.5._
- [x] **T4.3** — Integration: `handle_new_user()` applies a multi-role invite.
      _DoD: AC-1.3._
- [x] **T4.4** — Smoke: the `roles=cs.{…}` filters against PostgREST. _DoD: the
      five call sites of T2.6 are exercised._
- [x] **T4.5** — E2E: a `pm+admin` reaches `/admin/*`, appears in the PM
      dropdown, and sees both nav sections. Plus a deactivated admin bouncing to
      `/pending-access` with a 403 from the API. _DoD: AC-2.1, AC-2.2, AC-4.1,
      AC-3.1._
- [x] **T4.6** — Update the fixtures that write a single role:
      `tests/e2e/session.ts` `createUser`, and the integration helpers.
      _DoD: the whole suite green — a missed one fails loudly, not silently._

## Phase 5 — Docs

- [x] **T5.1** — ADR 0011 on multiple roles: why an array and not a junction
      table, and why `active` lives inside `has_role()`.
- [x] **T5.2** — Revise the **text** of ADR 0009 and 0010: both reason about
      authorisation with the role as a single value. The column guard of 0009
      does not change — it is identity, not role — but its wording does.
- [x] **T5.3** — `CLAUDE.md`: the roles convention, and the "Reservas" section
      where it says the admin is not a shortcut for approving (still true, and
      now worth saying next to multiple roles).
- [x] **T5.4** — `docs/deuda-tecnica.md`: D-09 and D-01 closed with the date and
      this feature as the answer. D-07 and D-08 stay open and say why.
- [x] **T5.5** — `specs/features/README.md`: add `012`, mark it `done`, and log
      Q-Q1/Q-Q2 in the draft table.
- [x] **T5.6** — Visual review of `/admin/users` against the `DESIGN.md`
      checklist. **Needs human eyes.** Done by the user on 2026-09-08: the role
      checkboxes and the multi-role column read correctly.

---

## Blocked / follow-ups

- [x] **F1** — **The two-phase migration we did not need.** **Promoted to a rule
      on 2026-09-08**: `CLAUDE.md` §Migrations now opens with the add → deploy →
      drop sequence, and says outright that `012` did it in one step and broke
      the deployed site for it. The reason it became a rule that day: the seed
      data came out and the database started holding real people.
      *(original note)* This one drops a
      column the deployed code reads, and that is only acceptable because the app
      has no users. The next schema change that lands with people inside has to
      add, coexist, and drop in a later migration. Written down here because the
      moment to remember it is the next migration, not this one.
- [ ] **F2** — **D-04 shrinks but does not close.** Killing the role `Select`
      removes two of its six raw-value cases. The other four —primary PM, and the
      three in `projects-table.tsx`— are still D-04 and need their own OK.
- [ ] **F3** — **`profiles: team directory read` lets anyone with a session read
      the team**, deactivated or not, and that is deliberate (AC-3.5). But it
      also means a user with **no role at all** can read it, which is F7 of `003`
      and D-02. Untouched here; the two are settled together or neither is
      understood.
