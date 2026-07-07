# 0001 — Tech stack: Next.js + Supabase + Vercel

- **Estado:** accepted
- **Fecha:** 2026-07-06

## Contexto

Arrancamos DevsCalendar desde cero. El cliente definió el stack: Next.js como framework web, Supabase como backend/DB/auth, y Vercel como plataforma de hosting. La decisión ya vino tomada; este ADR la registra formalmente para futuros contribuyentes.

## Decisión

- **Framework:** Next.js con App Router y TypeScript en modo strict.
- **Backend:** Supabase — Postgres, Auth (con Google OAuth), Row Level Security, Realtime, Storage.
- **Hosting:** Vercel.
- **Migraciones:** Supabase CLI, versionadas en `supabase/migrations/`.
- **CI/CD:** Vercel deploya `main` a producción y cada PR a un preview environment. Migraciones se aplican vía Supabase CLI en un workflow de GitHub Actions (a definir cuando se inicialice el repo de código).

## Consecuencias

**Positivas:**

- Supabase ofrece RLS + Auth + Realtime de fábrica, cubre requisitos no funcionales de seguridad y de UX (notificaciones en tiempo real) sin infraestructura extra.
- Vercel + Next.js: preview deploys automáticos, DX rápido.
- Todo el equipo puede trabajar sobre TypeScript sin cambiar de lenguaje entre cliente y servidor.

**Negativas / a mitigar:**

- Vendor lock-in en Supabase para auth y RLS. Mitigación: usar Postgres puro donde sea posible; evitar features Supabase-only sin justificación.
- Vercel tiene límites de duración de function; jobs largos (retry de sync a Google Calendar) requieren considerar Vercel Cron / colas externas si crecen.
- RLS mal diseñada es dificilísima de corregir después. Mitigación: constitution obliga tests de RLS desde la primera tabla.

## Alternativas consideradas

Todas descartadas por decisión del cliente antes de arrancar. Se documentan por si el contexto cambia:

- **Backend custom (Node/NestJS + Postgres):** más control, más laburo. Peor DX de auth y realtime.
- **Firebase:** buen DX pero NoSQL no encaja con la naturaleza relacional del dominio (proyectos, reservas, prioridades, integridad referencial).
- **Otros PaaS Postgres (Neon, Fly.io):** similares a Supabase en DB pero requieren traer auth por afuera.
