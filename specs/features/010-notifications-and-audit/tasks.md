# Tasks — Notifications & audit log

- **ID:** 010-notifications-and-audit
- **Plan reference:** `./plan.md`
- **Status:** done el 2026-09-08, salvo T3.3 (revisión visual, necesita ojos humanos) y F1 (el proveedor de email, que es tuyo)

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **The trigger runs inside the booking write.** If it throws, the booking fails
> — not the notification. Keep it to resolving a recipient and inserting; no
> business rules, nothing that can fail on data. R-1 of `plan.md` §7.

> **This migration is purely additive**, so it satisfies the two-phase rule
> (`CLAUDE.md` §Migrations) with nothing to do: new table, new functions, new
> trigger, nothing dropped. That matters now — since 2026-09-08 the database
> holds real people.

---

## Phase 1 — Database

- [x] **T1.1** — Migration `00000000000011_notifications.sql`: the table from
      `plan.md` §3.1, RLS per §3.2, grants explicit. _DoD: RLS enabled, and no
      `insert`/`update` grant for `authenticated` — the triggers are the only
      writers._
- [x] **T1.2** — The notification trigger (§3.3): `after insert or update on
    bookings`, `security definer`, six events, and the AC-1.6 filter in ONE
      place — skip when `recipient_id = auth.uid()`. `service_role` has a null
      `auth.uid()` and must keep generating rows, or the fixtures go blind.
      _DoD: T4.2._
- [x] **T1.3** — `mark_notifications_read(uuid[])`, `security definer`, touching
      only `read_at` and only the caller's rows. `revoke all from public` +
      `grant execute to authenticated`, like every other definer function here.
- [x] **T1.4** — `audit_log` gains `create` and `update` for bookings (§3.5).
      _DoD: creating and editing a booking each leave their row; the existing
      `status_change` and `reallocated` rows keep working._
- [x] **T1.5** — `pnpm db:push` then `pnpm db:types`, comparing with
      `diff --strip-trailing-cr` (CRLF working tree, LF generator — `006` T1.4).

## Phase 2 — Delivery

- [x] **T2.1** — `src/lib/notifications/events.ts`: pure functions deciding type,
      recipient and payload per event. No Supabase import. _DoD: T4.1._
- [x] **T2.2** — `src/lib/notifications/email.ts`: `sendEmail()` behind the small
      interface of `plan.md` §4, plus the message templates as pure functions.
      **Without the API key it returns `{ok:false}` and nothing breaks** — rows
      stay `pending` and the in-app inbox is unaffected.
- [x] **T2.3** — `POST /api/notifications/dispatch`: claims pending rows with the
      `returning` update of R-3, sends, records `sent`/`failed`/`skipped`.
      Authenticated by `CRON_SECRET` compared in constant time, and it **never
      returns notification content** — counts only.
- [x] **T2.4** — Best-effort inline dispatch after the booking write paths, fired
      without awaiting. _DoD: a failing provider does not slow down or break
      creating a booking._
- [x] **T2.5** — `POST /api/notifications/read` over the function from T1.3.
- [x] **T2.6** — `vercel.json` cron entry pointing at the dispatch endpoint.
      **Check the plan first:** Hobby runs crons once a day, per-minute cadence
      is Pro (`plan.md` §2).

## Phase 3 — UI

- [x] **T3.1** — `NotificationBell` in the shell header: badge with the unread
      count, popover with the latest, each item linking to its booking.
      _DoD: AC-4.1, AC-4.2._
- [x] **T3.2** — Refresh on navigation plus `visibilitychange`; no Realtime
      (AC-4.4).
- [ ] **T3.3** — Copy and states per `DESIGN.md`, including the empty one. Name
      it so it does not read as a second `/inbox`: the bell is "what happened",
      `/inbox` is "what I have to answer". _DoD: the `DESIGN.md` checklist._

## Phase 4 — Tests

- [x] **T4.1** — Unit: the event functions, including AC-1.6 and the `012` case —
      someone who is both PM and the developer of the same booking.
- [x] **T4.2** — Integration: one case per event, **reading the rows back**;
      displacement writes two; your own action writes none; a deactivated
      recipient ends `skipped`.
- [x] **T4.3** — Integration: RLS — nobody reads someone else's notifications,
      nobody inserts by hand, and a **deactivated** user still reads their own
      (the `select` deliberately skips `has_role()`).
- [x] **T4.4** — Integration: `audit_log` gets its row for create and for update.
- [x] **T4.5** — ~~Smoke: the inbox select with its booking/project embed.~~ **No
      aplica, y por una buena razón:** el select de la bandeja no tiene embed. El
      payload se congela al escribir la fila (ADR 0012), así que la campana no
      necesita traerse el proyecto por join — que es justo lo que un smoke test
      habría verificado. Se cubre en integración como cualquier otro select.
- [x] **T4.6** — E2E: the flow that justifies the feature — a priority project
      displaces a confirmed booking and **the displaced PM sees the bell** naming
      the project that took the slot.
- [x] **T4.7** — Fixtures: notifications are created by triggers, so every
      existing test that writes a booking now also writes notifications. Check
      the cleanup helpers delete them (the FK is `on delete cascade`, so deleting
      the booking should be enough — confirm rather than assume).

## Phase 5 — Docs

- [x] **T5.1** — ADR: the outbox — why the row is written by a trigger inside the
      event's transaction and the send is a separate, retryable step.
- [x] **T5.2** — `CLAUDE.md`: the notifications convention, and the `on delete
    cascade` deviation of §3.1 with its reason.
- [x] **T5.3** — `.env.example`: `RESEND_API_KEY` and `CRON_SECRET`, with the
      same tone as the rest of the file — what they are for and where they live.
- [x] **T5.4** — `specs/features/README.md`: `010` done; Q-9 and Q-M answered.
- [x] **T5.5** — Close AC-1.2 / AC-3.1 in `005` and AC-2.1 in `006`, which were
      deferred here.

---

## Blocked / follow-ups

- [ ] **F1** — **The email provider is a prerequisite the user has to do**: an
      account, a verified sending domain, and the key in Vercel. Phases 1-4 do
      not depend on it — the in-app half ships and works without it.
- [ ] **F2** — **R-2 of `006` is still open and this feature does not close it.**
      Priority plays at create, not at approve. Notifications make the collision
      visible sooner, which helps, but the hole is the same. See F4 of
      `006/tasks.md`.
- [ ] **F3** — **No digest.** One notification per event. With a small team and
      few bookings that is fine; if it turns into noise, group before adding
      per-user preferences — the preference nobody configures is the one that
      makes the product feel broken.
