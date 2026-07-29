# DevsCalendar

Plataforma de planificación de recursos para equipos de desarrollo. Los PMs reservan tiempo de desarrolladores sobre proyectos, con vista de calendario tipo Google Calendar, aprobación del dev, anti doble-booking, prioridad entre proyectos e integraciones con Google Calendar, Jira y Slack.

**Estado:** en desarrollo · Feature `001-auth-and-permissions` conectada a Supabase local, con auth + RLS + tests funcionando.

## Stack

Next.js 15 (App Router, TypeScript strict) · Supabase (Postgres + Auth + RLS) · Tailwind CSS · Vercel · pnpm.

Ver `docs/adr/0001-tech-stack.md` para el detalle y motivo de cada elección.

## Quick start

```bash
# 1. Dependencias
pnpm install

# 2. Supabase — elegí una opción:
#    (a) local:  brew install supabase/tap/supabase && supabase start
#    (b) cloud:  crear el proyecto en supabase.com

# 3. Configurar env vars
cp .env.example .env.local
# Editar .env.local con NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY

# 4. Aplicar migrations
pnpm db:push        # cloud
# ó
supabase db reset   # local

# 5. Habilitar Google OAuth en el dashboard de Supabase
#    (Auth → Providers → Google, con credenciales de Google Cloud Console)

# 6. Generar los types de Supabase
pnpm db:types

# 7. Arrancar el dev server
pnpm dev
```

Scripts disponibles: ver la sección "Cómo correr localmente" de `CLAUDE.md`.

## Tests

```bash
# Integration (Vitest, contra Supabase local — requiere `supabase start` corriendo
# y .env.local con NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)
pnpm test

# E2E (Playwright — levanta `pnpm dev` automáticamente si no está corriendo)
pnpm test:e2e
```

Los tests de integración (`tests/integration/`) crean y borran usuarios de prueba vía `auth.admin` en cada corrida — no tocan tu sesión ni tus datos manuales.

## Requisitos

- Node.js **22+** (funciona en 20 pero Supabase lo tiene deprecated).
- pnpm 9+.
- Docker (solo si usás Supabase local via CLI).

## Estructura del repo

```
├── CLAUDE.md                  # guía para trabajar en el repo (leé esto primero)
├── devscalendar-specs.md      # spec funcional original del cliente (v0.1)
├── src/                       # código de la app Next.js
├── supabase/                  # config local + migrations versionadas
├── specs/                     # SDD harness (constitution, glosario, features)
│   ├── constitution.md        # principios técnicos y de calidad
│   ├── glossary.md            # términos del dominio
│   └── features/              # una carpeta por feature (spec → plan → tasks)
└── docs/adr/                  # architecture decision records
```

## Cómo trabajamos

**Spec-Driven Development.** Ningún código sin spec previa. El flujo por feature es:

1. `spec.md` — qué y por qué (español).
2. `plan.md` — cómo, a alto nivel (español + nombres técnicos en inglés).
3. `tasks.md` — checklist ejecutable (inglés).
4. Implementación — se ejecutan las tareas; la spec y el plan son fuente de verdad.

Más detalle en `specs/README.md`.

## Idiomas

Español para specs, plans, glosario y copy visible al usuario. Inglés para código, tests, commits y PRs. Ver `docs/adr/0002-language-conventions.md`.

## Referencias rápidas

| Buscás… | Andá a… |
| :---- | :---- |
| Cómo trabajar en el repo | `CLAUDE.md` |
| Spec funcional original | `devscalendar-specs.md` |
| Principios técnicos inmutables | `specs/constitution.md` |
| Lista de features del MVP | `specs/features/README.md` |
| Decisiones de arquitectura | `docs/adr/` |
| Términos del dominio | `specs/glossary.md` |
