# Tasks — Auth & permissions

- **ID:** 001-auth-and-permissions
- **Plan reference:** `./plan.md`
- **Status:** done — la feature cerró con `002`. Quedan D-01 y D-02 en "Deuda registrada", abajo.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

---

## Phase 0 — Repo bootstrap

- [x] **T0.1** — Scaffold Next.js (App Router, TS strict, Tailwind, ESLint). _DoD: `pnpm build` passes on a bare app._
- [x] **T0.2** — Add ADR 0003 documenting the pnpm + Tailwind + shadcn-on-demand + Vitest/Playwright decision.
- [x] **T0.3** — Add `.env.example`, `.gitignore`, `.prettierrc.json`.

## Phase 1 — Supabase wiring (code only, no live project yet)

- [x] **T1.1** — Install deps: `@supabase/supabase-js`, `@supabase/ssr`, `zod`. _DoD: lockfile committed._
- [x] **T1.2** — Add `src/lib/supabase/server.ts`, `client.ts`, `middleware.ts` following @supabase/ssr conventions for App Router.
- [x] **T1.3** — Add `src/lib/env.ts` that validates `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at boot with Zod.
- [x] **T1.4** — Add `supabase/config.toml` (so `supabase start` works when the user opts in locally).

## Phase 2 — Initial migration

- [x] **T2.1** — Migration `00000000000000_auth_and_profiles.sql` with:
  - [x] `user_role` enum (`admin`, `pm`, `developer`).
  - [x] `profiles` table with FK to `auth.users`, `role` nullable, `active` default true.
  - [x] `current_user_role()` helper (SECURITY DEFINER).
  - [x] RLS policies on `profiles` (self read, admin read all, admin manage).
  - [x] `handle_new_user()` trigger on `auth.users`.
- [x] **T2.2** — When the user connects Supabase: run `pnpm supabase db push` (or apply migration in dashboard). _DoD: table + trigger + policies present._
- [x] **T2.3** — Generate types with `pnpm supabase gen types typescript --local > src/types/database.ts` (or `--linked` when connected to cloud).

## Phase 3 — Auth UI + routes

- [x] **T3.1** — `src/middleware.ts` — protect all routes except `/login`, `/auth/*`, static assets. Refresh session on every request.
- [x] **T3.2** — `src/app/login/page.tsx` — landing with "Continuar con Google" button (calls `signInWithOAuth`).
- [x] **T3.3** — `src/app/auth/callback/route.ts` — exchange code for session, redirect to `?next` or `/`.
- [x] **T3.4** — `src/app/auth/signout/route.ts` — POST endpoint that clears session and redirects to `/login`.
- [x] **T3.5** — `src/app/page.tsx` — authenticated home. Fetch profile server-side; show name, email, role, or "sin acceso" if role is null.
- [x] **T3.6** — `src/app/pending-access/page.tsx` — informational page for users authenticated without a role.

## Phase 4 — Tests

- [x] **T4.1** — Vitest + integration test setup pointing to a local Supabase (documented in a README). Blocked by T2.2.
- [x] **T4.2** — Test: create two auth users, insert profiles, assert that user A cannot read user B's profile (RLS).
- [x] **T4.3** — Test: inserting into `auth.users` fires the trigger and creates a `profiles` row.
- [x] **T4.4** — Playwright smoke test: unauth user visits `/`, is redirected to `/login`.

## Phase 5 — Docs & handoff

- [x] **T5.1** — Update `CLAUDE.md` with code structure and local dev instructions.
- [x] **T5.2** — Update `specs/features/README.md`: mark 001 as `in-progress`, then `done` when tests pass.
- [~] **T5.3** — Confirm open questions with the client before feature closes:
  - [x] Q-5 (dev sees global calendar or only own) — **cerrada por `005` el 2026-08-31:** calendario global en modo lectura, y `/inbox` es una vista sobre eso. El filtro por `dev_id` vive en el query y no en una policy. Ver la tabla de `specs/features/README.md`.
  - [ ] Q-6 (client role in Phase 1?) — sigue diferida a Fase 2; el enum es extensible. **Cuidado con la etiqueta:** el `Q-6` de `specs/features/README.md` es *otra* pregunta (si la realocación saltea la aprobación del dev), cerrada por `006`. Son dos preguntas distintas con el mismo nombre, y la de acá sigue abierta.

---

## Blocked / follow-ups

- [x] **F1** — Configurar el proyecto Supabase (cloud o CLI local) y proveer credenciales en `.env.local`. Owner: usuario.
- [x] **F2** — Habilitar Google OAuth provider en Supabase con las redirect URIs correctas.
- [x] **F3** — Instalar shadcn/ui cuando se necesite el primer componente reutilizable. **Hecho en `002` T3.1**, antes de lo previsto: el preset Nova sobre Base UI, que además disparó la migración del proyecto entero a Tailwind v4 (ADR 0006).

---

## Deuda registrada (2026-09-07)

Levantada auditando los AC de esta feature contra el código. **No se salda sin OK
explícito del usuario** — ver `docs/deuda-tecnica.md`, que es el registro central.

- [ ] **D-01** — **`active = false` solo se aplica en la UI.** El único lugar del
      camino de autorización que mira `profiles.active` es
      `src/app/(app)/layout.tsx:26`, que es un layout de UI, y no hay layout en
      `/api/*`. `requireAdmin()` selecciona solo `role`
      (`src/lib/api/require-admin.ts:28-32`); `requireBookingAccess()` y
      `requireBookingResponder()` usan `getCurrentProfile()`, que **trae**
      `active` (`src/lib/supabase/session.ts:43`) y no lo consultan; el
      middleware corre sobre `/api/*` pero solo verifica que exista un `user`
      (`src/lib/supabase/middleware.ts:41`). En la base pasa igual:
      `current_user_role()` (`00000000000000_auth_and_profiles.sql:47`),
      `can_manage_booking()` (`00000000000006_bookings_write_path.sql:44`) y la
      policy `bookings: developer responds` (`00000000000007:38`) ignoran
      `active`, así que la RLS tampoco lo ataja.
  - **Consecuencia:** un admin desactivado sigue creando clientes, proyectos y
    usuarios por API; un PM desactivado sigue creando y cancelando reservas; un
    dev desactivado sigue aprobando las suyas. No hace falta una sesión vieja:
    volver a loguearse con Google le devuelve sesión igual.
  - **Es un descuido, no una decisión, y hay dos pruebas:** `reallocate_booking()`
    **sí** chequea `active` (`00000000000008_reallocation.sql:85,101`, error
    `DC004`) — el camino más nuevo lo hace bien y los viejos no —; y
    `plan.md:156` de esta misma feature afirma que el middleware redirige con
    `active = false`, cosa que nunca se implementó ahí.
  - **Gate: antes del primer usuario real.** Hoy no hay a quién desactivar.
  - Al saldarla, ojo con el orden de la migration: tocar `current_user_role()`
    cambia de golpe el comportamiento de **todas** las policies que lo usan.
    Necesita tests de integración que **lean la fila de vuelta**, no que miren el
    código de error (la lección de `004` T4.2).
- [ ] **D-02** — **AC-1.3 salió reinterpretada y el desvío nunca se registró.** El
      AC (`spec.md:35`) pide que un email no dado de alta **no deje sesión
      iniciada**; lo implementado deja la sesión abierta y muestra
      `/pending-access`. Es la decisión correcta —sin sesión no se sabe a quién
      mostrarle el cartel ni qué email nombrar— pero hoy el AC y el código dicen
      cosas distintas y nadie lo sabe.
  - Importa porque es justo lo que vuelve alcanzable a **F7 de `003`**: alguien
    con sesión y sin rol puede leer `clients` y `projects`, cuyas policies de
    `select` siguen en `using (true)`
    (`00000000000001_clients_and_projects.sql:62,73`). Las dos se entienden
    juntas o no se entiende ninguna.
- [ ] **D-09** — **Un rol por persona, y hay gente que es PM y admin a la vez.**
      `user_role` es un enum de **un solo valor** (`00000000000000_auth_and_profiles.sql:8`),
      así que hoy no se puede modelar a alguien que sea las dos cosas. El
      problema no es de permisos de operación sino de **pertenencia**:
  - **Para operar reservas, `admin` ya es superconjunto de `pm`**, sobre todos
    los proyectos y no solo los propios. La regla aparece cuatro veces, siempre
    igual: `can_manage_booking()` (`00000000000006:44`), `requireBookingAccess()`
    (`src/lib/api/require-booking-access.ts:33`), `canManageProject()`
    (`src/lib/bookings/permissions.ts:23`) y el filtrado de proyectos de
    `getBookingOptions()` (`src/lib/bookings/options.ts:46`), que acota al PM a
    los suyos y al admin no lo acota. La única excepción es **aprobar**, que es
    de identidad y no de rol (ADR 0009).
  - **Pero para *ser* el PM responsable, el admin está excluido.**
    `projects.pm_id` exige `role = 'pm'` exacto en tres lugares
    (`api/projects/route.ts:29`, `api/projects/[id]/route.ts:33`, y el
    desplegable de `admin/projects/page.tsx:21`), y `profiles.primary_pm_id`
    hace lo mismo (`api/users/[id]/route.ts:33`, `admin/users/page.tsx:19`). Es
    R-3 de `002`: la regla vive solo en la app, porque Postgres no puede exigir
    que una FK apunte a un profile con cierto rol. **En la base, `pm_id` es una
    FK a `profiles` sin ninguna restricción de rol.**
  - **Consecuencia hoy:** hay que elegir. Con `admin` entra a `/admin/*` y opera
    todo, pero ningún proyecto puede nombrarlo responsable, así que cada uno de
    "sus" proyectos lleva a otra persona en `pm_id`. Con `pm` puede ser
    responsable pero pierde `/admin/*` entero.
  - **Lo peor de eso no se ve todavía y es de `010`:** las notificaciones salen
    hacia el `pm_id`. Si el responsable nominal no es quien realmente lleva el
    proyecto, el aviso de "te desplazaron una reserva confirmada" le llega a la
    persona equivocada — y ese aviso es justamente el gate duro antes del primer
    deploy con usuarios reales.

  **Decisión del usuario, 2026-09-07: se resuelve con roles múltiples.** No con
  el atajo de aceptar `admin` en `pm_id`, que era el cambio de cinco líneas.
  Una persona va a poder tener `pm` y `admin` a la vez, y "PM responsable de un
  proyecto" pasa a ser una pregunta sobre si tiene el rol `pm`, no sobre si es
  lo único que es.

  **Lo que toca, para dimensionarlo antes de empezar:**
  - **La base.** `profiles.role` singular pasa a un conjunto — array de
    `user_role` o tabla `profile_roles`. Y sobre todo **`current_user_role()`
    (`00000000000000:47`), que es la puerta de casi todas las policies** y hoy
    devuelve *un* rol: pasa a ser una pregunta de pertenencia
    (`has_role('admin')`). Cambiarla altera de golpe el comportamiento de todo
    lo que la usa. `handle_new_user()` y `profile_invites` también asignan un
    rol único.
  - **Los guards y las funciones puras.** `requireAdmin()`,
    `requireBookingAccess()`, `canManageProject()`, `canCreateBookings()`,
    `getCurrentProfile()`, `getBookingOptions():46`, más las tres validaciones
    de `!== "pm"` y el `role` que `AppShell` usa para armar la navegación
    (`app-shell.tsx:146,150`), que hoy es un `if / else if` y pasa a ser unión.
  - **La UI.** `/admin/users` cambia de un `Select` de rol a selección múltiple,
    y la columna `Rol` de la tabla pasa a listar varios. Los dos desplegables de
    PM dejan de filtrar por `role = 'pm'` exacto.
  - **Los ADR.** Hay que escribir uno propio, y **revisar 0009 y 0010**: los dos
    razonan sobre autorización con el rol como valor único. El guard de columnas
    de 0009 no se toca (es de identidad), pero su texto sí.
  - **Los tests.** `tests/e2e/session.ts:13` crea usuarios con un rol; las
    fixtures de integración también. Y hace falta el caso nuevo que hoy no se
    puede escribir: alguien con `pm` + `admin`.

  **Esperaba a Q-A y a Q-6, y las dos se respondieron el 2026-09-07.** Q-A
  —¿varios PMs por proyecto?— era la que importaba: si la respuesta hubiera sido
  que sí, la pertenencia de un proyecto dejaba de ser un `pm_id` singular y las
  dos cosas se rediseñaban a la vez. **Salió que no: un PM primario
  obligatorio.** Q-6 —¿accede el rol Cliente?— **salió que no accede**, así que
  el enum se queda en tres valores y no hay que tocarlo dos veces. **Ya no
  quedan preguntas de producto detrás de esta deuda: falta solo el OK.**

  **Gate:** no bloquea nada hoy, pero **hay que resolverlo antes de `010`**, o
  las notificaciones se construyen sobre un `pm_id` que ya se sabe que miente.
