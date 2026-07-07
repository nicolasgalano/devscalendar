# DevsCalendar

> Plataforma de planificación de recursos para equipos de desarrollo: los PMs reservan tiempo de devs sobre proyectos, con vista de calendario tipo Google Calendar, aprobación del dev, anti doble-booking, prioridad entre proyectos e integraciones con Google Calendar, Jira y Slack.

**Estado:** en desarrollo — feature `001-auth-and-permissions` scaffoldeada.

---

## Stack

- **Framework:** Next.js 15 (App Router, TypeScript strict)
- **Backend / DB / Auth:** Supabase (Postgres 15, Row Level Security, Auth con Google OAuth) vía `@supabase/ssr`
- **Estilos:** Tailwind CSS 3
- **Componentes:** shadcn/ui — se agregan on-demand (ADR 0003)
- **Validación:** Zod
- **Package manager:** pnpm
- **Hosting:** Vercel
- **Integraciones externas:** Google Calendar API, Jira REST, Slack Web API + Events

Ver `specs/constitution.md` para el detalle de restricciones técnicas y de calidad.

---

## Cómo trabajamos (Spec-Driven Development)

Flujo por feature: **spec → plan → tasks → implementación**. Ver `specs/README.md`.

- Toda feature vive bajo `specs/features/NNN-<slug>/`.
- Cambios que afecten varias features → ADR en `docs/adr/`.
- Nada de código sin spec previa. Si aparece necesidad urgente durante la implementación, se actualiza la spec en el mismo PR.

---

## Idiomas y convenciones

- **Español:** specs, plans, glosario, ADRs de producto, copy de UI.
- **Inglés:** código, tests, commits, PRs, tasks.md, logs.

Ver `docs/adr/0002-language-conventions.md`.

---

## Estructura del repo

```
devscalendar/
├── CLAUDE.md
├── devscalendar-specs.md             # spec funcional original (v0.1)
├── package.json                      # pnpm + Next.js
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── .env.example                      # variables requeridas
├── src/
│   ├── app/                          # rutas Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # home autenticada
│   │   ├── globals.css
│   │   ├── login/                    # login page + button (client)
│   │   ├── pending-access/           # usuarios autenticados sin rol
│   │   └── auth/
│   │       ├── callback/route.ts     # OAuth exchange
│   │       └── signout/route.ts
│   ├── middleware.ts                 # protege rutas + refresh de sesión
│   ├── lib/
│   │   ├── env.ts                    # validación de env con Zod
│   │   └── supabase/                 # server/client/middleware helpers
│   └── types/
│       └── database.ts               # placeholder; regenerar con `pnpm db:types`
├── supabase/
│   ├── config.toml                   # `supabase start` local
│   ├── migrations/                   # SQL versionado
│   └── seed.sql
├── specs/                            # SDD harness (spec/plan/tasks por feature)
└── docs/
    └── adr/                          # architecture decision records
```

---

## Cómo correr localmente

Antes del primer run necesitás:

1. **Instalar deps:** `pnpm install`.
2. **Configurar Supabase.** Dos opciones:
   - **Local (recomendado para dev):** instalar Supabase CLI (`brew install supabase/tap/supabase`), después `supabase start`. Guardar la anon key impresa en `.env.local`.
   - **Cloud:** crear proyecto en supabase.com, copiar URL + anon key en `.env.local`.
3. **Aplicar migrations:** `pnpm db:push` (o `supabase db reset` si es local).
4. **Habilitar Google OAuth:** en Supabase dashboard → Auth → Providers → Google. Cargar client id + secret de Google Cloud Console. Agregar la redirect URI que Supabase indica al proyecto de Google.
5. **Generar types:** `pnpm db:types`.
6. **Arrancar Next.js:** `pnpm dev`.

Scripts útiles:

- `pnpm dev` — servidor de desarrollo.
- `pnpm build` — build de producción.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm lint` — ESLint.
- `pnpm format` — Prettier.
- `pnpm db:push` — aplica migrations al Supabase enlazado.
- `pnpm db:types` — regenera `src/types/database.ts`.

---

## Convenciones de código

- **Server Components** por defecto. `"use client"` lo más profundo posible en el árbol.
- **Cliente Supabase:** `@/lib/supabase/server` en Server Components / Route Handlers; `@/lib/supabase/client` en Client Components; `@/lib/supabase/middleware` solo dentro del middleware.
- **Nunca** usar la `service_role` key desde código cliente. Solo en scripts server-side puntuales.
- **RLS es obligatoria** en toda tabla nueva; la migration falla el review si no la incluye.
- **Nombres:** `kebab-case.ts` para archivos, `PascalCase` para componentes y tipos, `camelCase` para variables/funciones.

---

## Estado de features

Ver `specs/features/README.md` para el índice completo y estado.

- **001-auth-and-permissions** — code scaffolded, esperando conexión a Supabase real. Ver `specs/features/001-auth-and-permissions/tasks.md`.
