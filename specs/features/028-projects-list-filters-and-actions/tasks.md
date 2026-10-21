# Tasks — Projects list: sort, search, active filter, actions

- **ID:** 028-projects-list-filters-and-actions
- **Plan reference:** `./plan.md`
- **Status:** todo

Task format: `[ ]` open, `[x]` done, `[~]` in progress, `[!]` blocked. Phases are independently mergeable and deployable.

---

## Phase 1 — RPC + endpoint (silent)

- [ ] **T1.1** — Create migration `supabase/migrations/00000000000025_set_project_active_rpc.sql` with the `set_project_active(uuid, boolean)` function per plan §3. Include `revoke all from public` + `grant execute to authenticated`. _DoD: migration file applies cleanly on a fresh DB (`pnpm db:push` on a scratch project); function visible with `\df set_project_active` in psql; grant is on `authenticated`, not `public`._
- [ ] **T1.2** — Regenerate types: `pnpm db:types`. Commit the regenerated `src/types/database.ts` in the same commit as T1.1 so CI sees the RPC signature. _DoD: `supabase.rpc("set_project_active", ...)` typechecks with `p_project_id: string, p_active: boolean` and `Returns: boolean`._
- [ ] **T1.3** — Append `setProjectActiveSchema` to `src/lib/validation/projects.ts` per plan §4. _DoD: schema parses `{ active: true }`, rejects `{ active: "yes" }`, rejects empty object._
- [ ] **T1.4** — Create handler `src/app/api/projects/[id]/active/route.ts` using `requireProjectMembership(id, "pm")` + `readJsonBody()` + the schema. Map error codes: `DC010` → 404, `42501` → 403, default → 500. Return `{ active: boolean }` on 200. _DoD: handler file compiles, follows the pattern of `/api/projects/[id]/route.ts`._
- [ ] **T1.5** — Integration tests `tests/integration/set-project-active.test.ts`:
  - admin togglea cualquier proyecto → OK + fila en `audit_log` (`entity='project'`, `action='active_toggled'`, `diff.old`, `diff.new`, `actor_id = admin`).
  - PM primario togglea su proyecto → OK + audit.
  - PM primario de otro proyecto intenta togglear ajeno → `42501`.
  - Contributor de proyecto intenta togglear → `42501`.
  - Toggle a mismo estado (true→true) → `audit_log` sin fila nueva, returns `true`.
  - Proyecto UUID inexistente → `DC010`.
  - PM primario con `profiles.active = false` → `42501` (porque `has_role('pm')` incluye `and active`).

  _DoD: `pnpm test:integration tests/integration/set-project-active.test.ts` corre en CI y pasa._

- [ ] **T1.6** — Smoke tests `tests/smoke/projects-active-endpoint.test.ts` — mismos escenarios que T1.5 pero via HTTP: 200 admin, 200 PM propio, 403 PM ajeno, 403 contributor, 400 body inválido, 404 proyecto inexistente. _DoD: `pnpm test:smoke` incluye estos y pasan._
- [ ] **T1.7** — Unit test `tests/unit/projects-validation.test.ts` para `setProjectActiveSchema`: acepta `{ active: true }`, acepta `{ active: false }`, rechaza `{}`, rechaza `{ active: "x" }`, rechaza extra fields silencio (depende del schema — Zod default no es strict). _DoD: 4 asserts pass._

**Phase 1 commit + merge + deploy.** Migration applied in prod. Endpoint live but **no consumer** — the UI still uses the admin-only PATCH from `/admin/projects`. Zero visible change for users.

---

## Phase 2 — UI del listado (toolbar + sort + acciones)

### 2a. Helpers puros (sin JSX)

- [ ] **T2.1** — Create `src/lib/projects/url.ts` with `parseProjectsUrl` and `projectsHref` per plan §5. Defaults: `q=""`, `active="on"`, `sort="name"`, `dir="asc"`. Parser must not throw on malformed input (fallback to defaults). Serializer must omit values equal to defaults. _DoD: round-trip of a canonical URL is identity; invalid `sort=xyz` → default `name`; `?sort=name&dir=asc` is the empty URL (defaults omitted)._
- [ ] **T2.2** — Create `src/lib/projects/filter-sort.ts` with `filterProjects(projects, { q, onlyActive })` and `sortProjects(projects, sort, dir)` per plan §5. Filter: normalize accents + lowercase on both sides; match `name` OR `client.name` by substring. Sort: `Intl.Collator("es-AR", { sensitivity: "base" })` for `name`/`client`/`pm`; `active` boolean for `status`; `key` as string. _DoD: see unit tests T2.3._
- [ ] **T2.3** — Unit tests for T2.1 and T2.2:
  - `tests/unit/projects-url.test.ts` — parse + serialize round-trip; defaults omitted; invalid values fall to defaults.
  - `tests/unit/projects-filter-sort.test.ts` — "cordoba" matches "Córdoba"; empty `q` returns all; `onlyActive=true` strips inactive; sort "name" asc vs desc swap; sort "client" uses `project.client.name`; sort "status" puts active first in asc.
  - `tests/unit/project-list-permissions.test.ts` — `canToggleActive(isAdmin, pmId, currentUserId)` returns true when admin, true when `pmId === currentUserId`, false otherwise, false when pmId is null.

  _DoD: `pnpm test:unit` passes all three files._

### 2b. Query y tipos

- [ ] **T2.4** — Refactor `getVisibleProjects()` in `src/lib/projects/workspace.ts`: remove the second query against `tickets` (lines ~77-89) and remove `openTicketCount` from `ProjectListRow`. Keep the base query ordered by `name` ASC (defaults will show that order). _DoD: `grep -rn "openTicketCount" src/` returns no hits except in the component being replaced in T2.6 (and that reference is also removed)._
- [ ] **T2.5** — Verify no other consumers of `ProjectListRow.openTicketCount` with `grep -rn "openTicketCount\|openTickets" src/`. If any found outside `<ProjectList>`, pause and discuss. _DoD: grep confirms the only consumer was `<ProjectList>`._

### 2c. UI del listado

- [ ] **T2.6** — Refactor `src/components/projects/project-list.tsx` to a client component (`"use client"`):
  - Add props `currentUserId: string` and `isAdmin: boolean`.
  - Use `useSearchParams()` + `useRouter()` for state.
  - Add toolbar above table: `<Input placeholder="Buscar proyecto o cliente…">` (debounced 200 ms) + `<Switch>` "Solo activos".
  - Headers for `Clave`, `Proyecto`, `Cliente`, `PM`, `Estado` become `<button>` wrappers that toggle sort via `router.replace(projectsHref(...))`. Active header shows `<ArrowUp>`/`<ArrowDown>`; inactive show `<ArrowUpDown>` dimmed.
  - Drop `openTicketCount` column header + cell.
  - Add new last column `Acciones` right-aligned.
  - Row is **no longer** a Link; `cursor-pointer` removed. Cells render plain text.
  - Actions cell: `<Button variant="ghost" size="sm" onClick={() => router.push(href)}>Ver</Button>` + conditional `<Button>` toggle when `isAdmin || project.pm?.id === currentUserId`.
  - Toggle handler: `fetch("/api/projects/${id}/active", { method: "POST", body: { active: !project.active } })`; on 200 `router.refresh()`; on non-200 set `error` state → inline `<p role="alert">` above the table.

  _DoD: visual check on `/projects` as admin matches spec AC-1 to AC-5._

- [ ] **T2.7** — Update `src/app/(app)/projects/page.tsx` to pass the two new props: `currentUserId={profile.id}` and `isAdmin={isAdmin(profile.roles)}`. _DoD: typechecks + renders._

### 2d. Verificación manual (post-deploy)

- [ ] **T2.8** — Smoke manual as **admin**: toggle on/off any project; verify `audit_log` row written; buscador filters by name and client (case + accents); sort every column asc/desc; "Tickets abiertos" column gone; URL reflects state and `?q=…&sort=…` restores on reload. _DoD: user confirms._
- [ ] **T2.9** — Smoke manual as **PM primario** of project X: toggle visible only on X; buscador + sort work; cannot see toggle on other projects. _DoD: user confirms._
- [ ] **T2.10** — Smoke manual as **contributor** (not PM primario, not admin): no toggle on any row; "Ver" works; buscador + sort work. _DoD: user confirms._

**Phase 2 commit + merge + deploy.** Feature closes — users see the new list.

---

## Phase 3 — Cierre

- [ ] **T3.1** — Update `specs/features/README.md` — change `028` status from `draft` to `code done (deployed YYYY-MM-DD)`.
- [ ] **T3.2** — Short note in `CLAUDE.md` under the "Rutas y permisos" section (or a new sub-bullet under projects): "Toggle de `projects.active` desde `/projects` pasa por `set_project_active()` RPC (admin + PM primario); el PATCH clásico sigue siendo admin-only. Mismo patrón que `reallocate_booking()` — ADR 0010." One or two lines.
- [ ] **T3.3** — Confirm no new technical debt lines in `docs/deuda-tecnica.md`. If T2.6 ended up pulling in a workaround (ej. headers no son `<button>` por constraint de shadcn), document it there explicitly.

---

## Not in scope (follow-ups, if they appear)

- Pagination for teams with 200+ active projects.
- Persisting filter state in the user profile (so a reload in a different tab remembers).
- Column visibility toggle (hide/show columns per user).
- Multi-select for bulk activate/deactivate.
- Confirmation modal before deactivation.
- Filter chips (ej. "Solo donde soy PM" / "Solo donde soy miembro").
- Keyboard shortcut to focus the search input (`/`).
- Highlight of matched substring in the search results.
