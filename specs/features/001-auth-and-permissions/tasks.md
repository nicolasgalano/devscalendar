# Tasks — Auth & permissions

- **ID:** 001-auth-and-permissions
- **Plan reference:** `./plan.md`
- **Status:** in-progress

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
- [ ] **T2.2** — When the user connects Supabase: run `pnpm supabase db push` (or apply migration in dashboard). _DoD: table + trigger + policies present._
- [ ] **T2.3** — Generate types with `pnpm supabase gen types typescript --local > src/types/database.ts` (or `--linked` when connected to cloud).

## Phase 3 — Auth UI + routes

- [x] **T3.1** — `src/middleware.ts` — protect all routes except `/login`, `/auth/*`, static assets. Refresh session on every request.
- [x] **T3.2** — `src/app/login/page.tsx` — landing with "Continuar con Google" button (calls `signInWithOAuth`).
- [x] **T3.3** — `src/app/auth/callback/route.ts` — exchange code for session, redirect to `?next` or `/`.
- [x] **T3.4** — `src/app/auth/signout/route.ts` — POST endpoint that clears session and redirects to `/login`.
- [x] **T3.5** — `src/app/page.tsx` — authenticated home. Fetch profile server-side; show name, email, role, or "sin acceso" if role is null.
- [x] **T3.6** — `src/app/pending-access/page.tsx` — informational page for users authenticated without a role.

## Phase 4 — Tests

- [ ] **T4.1** — Vitest + integration test setup pointing to a local Supabase (documented in a README). Blocked by T2.2.
- [ ] **T4.2** — Test: create two auth users, insert profiles, assert that user A cannot read user B's profile (RLS).
- [ ] **T4.3** — Test: inserting into `auth.users` fires the trigger and creates a `profiles` row.
- [ ] **T4.4** — Playwright smoke test: unauth user visits `/`, is redirected to `/login`.

## Phase 5 — Docs & handoff

- [x] **T5.1** — Update `CLAUDE.md` with code structure and local dev instructions.
- [ ] **T5.2** — Update `specs/features/README.md`: mark 001 as `in-progress`, then `done` when tests pass.
- [ ] **T5.3** — Confirm open questions with the client before feature closes:
  - [ ] Q-5 (dev sees global calendar or only own) — impacts later `bookings` RLS but nice to have decided.
  - [ ] Q-6 (client role in Phase 1?) — currently deferred; the enum is extensible.

---

## Blocked / follow-ups

- [ ] **F1** — Configurar el proyecto Supabase (cloud o CLI local) y proveer credenciales en `.env.local`. Owner: usuario.
- [ ] **F2** — Habilitar Google OAuth provider en Supabase con las redirect URIs correctas.
- [ ] **F3** — Instalar shadcn/ui cuando se necesite el primer componente reutilizable (probablemente al arrancar 003-calendar-ui).
