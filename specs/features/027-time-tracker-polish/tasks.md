# Tasks — Time tracker polish + timer start

- **ID:** 027-time-tracker-polish
- **Plan reference:** `./plan.md`
- **Status:** todo

Task format: `[ ]` open, `[x]` done, `[~]` in progress, `[!]` blocked. Phases are independently mergeable and deployable.

---

## Phase 1 — Fixes cosméticos del dialog (3 bugs)

- [ ] **T1.1** — Remove the manual `<button XIcon>` in `<TimeEntryDialog>` header (`time-entry-dialog.tsx:227-234`). Rely on the default close button that `<DialogContent>` ships with. If the default is missing, pass the `onClose` handler explicitly. _DoD: screenshot shows a single X; Esc still closes; click outside still closes._
- [ ] **T1.2** — Diagnose and fix the `__none__` string showing in the ticket dropdown placeholder. Primary hypothesis: change `value={form.ticketId ?? NO_TICKET}` → `value={form.ticketId ?? ""}` and update `onChange` to map `""` back to `null`. If the fix doesn't close it, debug `<SelectValue>` behavior in the browser and apply the minimum workaround. _DoD: with no ticket selected, the collapsed select shows "Elegí un ticket (opcional)" or "Sin ticket" — never `__none__`._
- [ ] **T1.3** — Create `<SearchableSelector>` in `src/components/time-entries/searchable-selector.tsx`. API: `items: { id, label, meta?: string }[]`, `value`, `onChange`, `placeholder`, `searchPlaceholder`, `emptyMessage`. Internally: Base UI `<Popover>` + `<Input>` + list filtered by `label.includes(query) || meta?.includes(query)` (case-insensitive). _DoD: dev test render with 20 items, type-filter works; auto-focus input on popover open; arrow keys navigate; Esc closes; empty query shows all items._
- [ ] **T1.4** — Replace `<SelectorRow>` with `<SearchableSelector>` for **project** and **ticket** selectors in `<TimeEntryDialog>`. Leave the **activity (tarea)** selector as `<SelectorRow>` — lists are short. _DoD: dialog renders; selecting works end-to-end; existing tests pass._
- [ ] **T1.5** — Unit test `searchable-selector.test.ts` — pure helper (if the filter is extracted) covers: case-insensitive match on `label`; match on `meta`; empty query returns all; no match returns empty + message rendered. _DoD: `pnpm test:unit tests/unit/searchable-selector.test.ts` passes._

**Phase 1 commit + merge + deploy.** Three visible bugs fixed; no new functionality yet.

---

## Phase 2 — Botón "Iniciar cronómetro" funcional

- [ ] **T2.1** — Create `<TimerStartDialog>` in `src/components/time-entries/timer-start-dialog.tsx`. Props: `open`, `onOpenChange`, `projects`, `activitiesByProject`, `ticketsByProject`. Uses `<SearchableSelector>` for project + ticket, `<SelectorRow>` for activity. Button "Iniciar" POSTs to `/api/time-entries/timer/start` with `{ project_id, activity_id, ticket_id }`. On 201 close + `router.refresh()`. On 409 show inline error. _DoD: dialog opens from a demo page; happy path creates a timer; TimerPill appears._
- [ ] **T2.2** — In `<WeeklyGridView>` (`weekly-grid-view.tsx:238`): remove `disabled title="Próximamente"`; add `onClick` that opens the new `<TimerStartDialog>`. Preserve the `disabled={isViewingOther}` logic — admin/PM looking at someone else's week still can't start a timer. _DoD: button enabled when viewing own week; disabled when viewing another user's._
- [ ] **T2.3** — Unit test `timer-start-payload.test.ts`: given a dialog state with `projectId`, `activityId`, `ticketId`, the function that builds the POST body produces the expected shape. _DoD: covers happy path + ticket null case + missing required field cases._
- [ ] **T2.4** — Manual verification in production (post-deploy): start a timer with project + task + ticket; confirm `<TimerPill>` appears; close browser; reopen; pill still there; stop; `time_entry` lands in the weekly grid. _DoD: user confirms._

**Phase 2 commit + merge + deploy.** Feature closes — timer start is live.

---

## Phase 3 — Cierre

- [ ] **T3.1** — Update `specs/features/README.md` — mark `027` as `code done (deployed YYYY-MM-DD)`.
- [ ] **T3.2** — Short note in `CLAUDE.md` under the time-tracking section about the start-timer UI landing in 027 (one line is enough — the pattern is reused from 016).
- [ ] **T3.3** — Confirm no new technical debt lines in `docs/deuda-tecnica.md` (unless Phase 1 workaround for `__none__` left one — document it there explicitly if so).

---

## Not in scope (follow-ups, if they appear)

- Virtualized list in `<SearchableSelector>` when a client has 1000+ tickets.
- Pause/resume on active timers.
- Timer start from a ticket detail page (one-click "start timer on this ticket").
- Highlight of matched substring in `<SearchableSelector>` results.
