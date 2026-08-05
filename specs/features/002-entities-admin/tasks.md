# Tasks — Entities admin (users, clients, projects)

- **ID:** 002-entities-admin
- **Plan reference:** `./plan.md`
- **Status:** done — 23 tests de integración + 4 E2E en verde, typecheck y lint limpios.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

---

## Phase 1 — Data & backend

- [x] **T1.1** — Migration `00000000000001_clients_and_projects.sql` con `clients` y `projects` (schema y RLS en `plan.md#3-modelo-de-datos`). Grants de tabla explícitos para `authenticated`/`service_role` (no repetir el bug de la migration de `001`). `updated_at` trigger reusando `public.set_updated_at()`. _DoD: migration corre limpia sobre DB fresca (`supabase db reset`); RLS habilitada en ambas tablas; grants verificados con un query de prueba desde `authenticated`._ Validado: `supabase db reset` corrió limpio sobre las 4 migrations (`000`–`003`) contra el stack local real.
- [x] **T1.2** — Migration `00000000000002_profile_invites_and_primary_pm.sql`: `profiles.primary_pm_id`, tabla `profile_invites`, y extensión de `handle_new_user()` (ver `plan.md#3-modelo-de-datos`). _DoD: test de integración (T4.2) cubre ambos caminos del trigger._ **Pendiente:** T4.2 (Fase 4).
- [x] **T1.3** — Migration `00000000000003_audit_log_minimal.sql`: tabla `audit_log` + trigger `projects_log_priority_change` (ver `plan.md#3-modelo-de-datos`). _DoD: cambiar la prioridad de un proyecto genera exactamente 1 fila en `audit_log` con el diff correcto; feature `010` puede reusar/extender esta tabla sin migrar datos._ **Pendiente:** T4.3 (Fase 4).
- [x] **T1.4** — Regenerar types: `pnpm db:types`. Corrido contra el stack local real (`supabase gen types typescript --local`); el resultado coincidió casi al carácter con la versión escrita a mano.
- [x] **T1.5** — Seed de fixtures en `supabase/seed.sql`: 1 cliente, 1 proyecto, para dev local. El cliente se sembró; el proyecto no (todavía no hay ningún profile con `role = 'pm'` en la DB local, es el comportamiento esperado — ver comentario en `seed.sql`).

## Phase 2 — API

- [x] **T2.1** — `POST /api/clients` — crear cliente. Auth: admin. Zod: `{ name: string }`.
- [x] **T2.2** — `PATCH /api/clients/[id]` — editar / desactivar (soft delete vía `active`). Auth: admin. Si el cliente tiene proyectos activos y se intenta desactivar, confirmar explícitamente en el payload (AC-1.2) en vez de bloquear.
- [x] **T2.3** — `POST /api/projects` — crear proyecto. Auth: admin. Zod: `{ name, clientId, pmId, priority, jiraEnabled, slackEnabled }` (AC-2.1).
- [x] **T2.4** — `PATCH /api/projects/[id]` — editar (incluyendo prioridad, dispara el trigger de auditoría de T1.3).
- [x] **T2.5** — `POST /api/users` — dar de alta un usuario por email + rol (AC-3.1). Si ya existe un profile con ese email y ya tiene rol, error "ese usuario ya existe"; si el profile existe pero está `role = null` (pending-access), se le asigna el rol directo; si no existe ningún profile, se inserta en `profile_invites`. Auth: admin.
- [x] **T2.6** — `PATCH /api/users/[id]` — cambiar rol, `active`, o `primary_pm_id` (AC-3.2, validar en app que el `primary_pm_id` referencie un profile con `role = 'pm'` — ver R-3).

## Phase 3 — UI

- [x] **T3.1** — Instalar shadcn/ui on-demand (F3 de `001`): `Button`, `Dialog`, `Input`, `Select`, `Table`, `DropdownMenu`, más `Label`, `Badge`, `Checkbox`. **Nota importante:** el `shadcn init` actual (preset Nova) genera CSS pensado para Tailwind v4; el repo tenía Tailwind v3. Se decidió con el usuario migrar el proyecto entero a **Tailwind CSS 4** (CSS-first, sin `tailwind.config.ts`) en vez de parchear el output — `CLAUDE.md` actualizado. Componentes basados en Base UI (`@base-ui/react`), no Radix.
- [x] **T3.2** — `/admin/clients` — listado + alta/edición/desactivación de clientes.
- [x] **T3.3** — `/admin/projects` — listado + alta/edición de proyectos (cliente, PM, prioridad, integraciones).
- [x] **T3.4** — `/admin/users` — listado + alta de usuarios (email + rol) + edición de rol/`primary_pm_id`.
- [x] **T3.5** — Guard de ruta: `/admin/*` solo accesible con `role = 'admin'` (layout server-side, mismo patrón que `pending-access`).

**Validación end-to-end (Fase 3):** sin acceso a Claude in Chrome en esta sesión (herramientas de navegador deshabilitadas), se verificó el flujo completo simulando una sesión admin real contra el Supabase local (usuario de prueba + cookie de sesión `sb-127-auth-token`, con la codificación exacta que usa `@supabase/ssr`): `/admin/clients`, `/admin/projects` y `/admin/users` renderizan con datos reales; `POST /api/clients`, `POST /api/projects`, `PATCH .../priority` y el flujo de confirmación de desactivación (AC-1.2) funcionaron end-to-end contra RLS real; el trigger de `audit_log` (T1.3) quedó confirmado insertando la fila esperada. Datos y usuarios de prueba borrados al terminar. **Pendiente:** verificación visual real en navegador (screenshots) — recomendable correrla con Claude in Chrome habilitado antes de dar la feature por cerrada.

## Phase 4 — Tests

- [x] **T4.1** — RLS: un usuario no-admin no puede insertar/editar `clients`/`projects`/`profile_invites` (solo `select`). `tests/integration/entities-rls.test.ts` — incluye además que nadie (ni admin) pueda escribir `audit_log` directo, y que un usuario sin rol quede afuera.
- [x] **T4.2** — Trigger `handle_new_user` con invite: crear un `profile_invites` con rol `pm`, crear el auth user con ese email, verificar que el profile nace con `role = 'pm'` y la invitación se borra. Caso sin invite: sigue naciendo con `role = null` (regresión sobre el test de `001`). `tests/integration/profile-invites.test.ts` — cubre además que una invitación dirigida a otro email no se aplique ni se consuma.
- [x] **T4.3** — Auditoría: cambiar `priority` de un proyecto inserta 1 fila en `audit_log` con el diff esperado; cambiar otro campo no inserta nada. `tests/integration/audit-log.test.ts` — verifica también `actor_id`, y que reescribir la misma prioridad no genere fila (`is distinct from`).
- [x] **T4.4** — Soft delete: desactivar un cliente con proyectos activos no borra nada, solo marca `active = false` en cascada según UI (no a nivel DB). Mismo archivo que T4.3.
- [x] **T4.5** — E2E (Playwright): un admin crea un cliente + proyecto + usuario desde `/admin/*` y los ve listados. `tests/e2e/admin-entities.spec.ts` + helper `tests/e2e/session.ts`, que planta una cookie de sesión válida porque el login real es Google OAuth y no se puede automatizar.
- [x] **T4.6** — (no planificada) Regresión de ciclo de vida de usuarios: `tests/integration/user-lifecycle.test.ts`. Ver "Bug encontrado" abajo.

### Bug encontrado por los tests (corregido)

Las migrations de la Fase 1 dejaban las tres FKs blandas hacia `profiles` en `no action`, lo que hacía **imposible dar de baja a un usuario** que hubiera sido PM primario de alguien, hubiera enviado una invitación, o hubiera cambiado la prioridad de un proyecto alguna vez. Además `audit_log` no tenía grant para `service_role`, así que ningún código server-side podía leer la auditoría (bloqueante para `010`).

Corregido editando las migrations en el lugar — sancionado por `plan.md` §11, porque no están desplegadas en ningún ambiente:

- `profiles.primary_pm_id`, `profile_invites.invited_by`, `audit_log.actor_id` → `on delete set null`.
- `projects.client_id` y `projects.pm_id` → `on delete restrict` explícito (la baja se bloquea a propósito: el camino es desactivar).
- `grant select, delete on public.audit_log to service_role` (sin insert/update: el trigger sigue siendo el único que escribe).

El test de regresión se validó revirtiendo la FK en la DB y confirmando que falla, para no dejar un test que pase por casualidad.

## Phase 5 — Docs & handoff

- [x] **T5.1** — Actualizar `CLAUDE.md`: estructura del repo al día, convenciones nuevas (route group `(app)`, guards de rol por layout, `requireAdmin()` + Zod en route handlers, `on delete` explícito en toda FK, leer `DESIGN.md` antes de tocar una vista), scripts de test, y la advertencia de no correr `build` con `dev` levantado.
- [x] **T5.2** — ADRs escritos: [0004](../../../docs/adr/0004-profile-invites.md) (invitación por email), [0005](../../../docs/adr/0005-audit-log-minimo.md) (`audit_log` mínimo) y [0006](../../../docs/adr/0006-tailwind-v4-base-ui-design-system.md) (Tailwind v4 + Base UI + `DESIGN.md`, que reemplaza la parte de estilos de 0003).
- [x] **T5.3** — `specs/features/README.md`: `002` marcada `done`, más una tabla de preguntas abiertas con el cliente.
- [x] **T5.4** — Q-A y Q-B documentadas para confirmar, junto con Q-2 y Q-6, en la tabla de `specs/features/README.md`. **No se pueden cerrar desde acá: requieren respuesta del cliente.** Q-2 (escala de prioridad) es la más urgente porque `DESIGN.md` y el modelo de datos hoy asumen dos niveles y `006` necesita resolver empates.

---

## Blocked / follow-ups

- [ ] **F1** — Cuando `010-notifications-and-audit` se implemente, migrar `audit_log` mínimo (T1.3) a su forma final (más `entity`/`action` values, tabla de notificaciones asociada). Owner: quien tome `010`.
- [ ] **F2** — Import masivo (CSV/Sheets) — explícitamente fuera de alcance de `002` (ver spec §5), queda para una feature futura si el cliente lo pide.
