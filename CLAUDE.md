# DevsCalendar

> Plataforma de planificación de recursos para equipos de desarrollo: los PMs reservan tiempo de devs sobre proyectos, con vista de calendario tipo Google Calendar, aprobación del dev, anti doble-booking, prioridad entre proyectos e integraciones con Google Calendar, Jira y Slack.

> Antes de crear o modificar cualquier vista, leé DESIGN.md y seguilo al pie de la letra. Al terminar, verificá la checklist final.

**Estado:** en desarrollo — features `001-auth-and-permissions`, `002-entities-admin`, `003-calendar-ui` y `004-bookings` terminadas.

---

## Stack

- **Framework:** Next.js 15 (App Router, TypeScript strict)
- **Backend / DB / Auth:** Supabase (Postgres 15, Row Level Security, Auth con Google OAuth) vía `@supabase/ssr`
- **Estilos:** Tailwind CSS 4 (CSS-first: sin `tailwind.config.ts`, theming vía `@theme` en `src/app/globals.css`)
- **Componentes:** shadcn/ui (preset Nova, base Base UI) — se agregan on-demand (ADR 0003)
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
├── DESIGN.md                         # sistema de diseño — leer antes de tocar una vista
├── devscalendar-specs.md             # spec funcional original (v0.1)
├── package.json                      # pnpm + Next.js
├── components.json                   # config de shadcn/ui
├── next.config.mjs
├── tsconfig.json
├── postcss.config.mjs                # Tailwind v4 (sin tailwind.config.ts)
├── playwright.config.ts
├── vitest.config.ts
├── .env.example                      # variables requeridas
├── src/
│   ├── app/                          # rutas Next.js App Router
│   │   ├── layout.tsx                # fuentes + ThemeProvider
│   │   ├── globals.css               # tokens de diseño (@theme inline)
│   │   ├── (app)/                    # route group: todo lo logueado, con shell
│   │   │   ├── layout.tsx            # gate de sesión + AppShell
│   │   │   ├── error.tsx             # error boundary de la app
│   │   │   ├── page.tsx              # redirige a /calendar
│   │   │   ├── calendar/             # pantalla principal (día/mes/año)
│   │   │   └── admin/                # ABM de maestros (solo admin)
│   │   │       ├── layout.tsx        # guard de rol
│   │   │       ├── clients/          # page + loading + tabla (client)
│   │   │       ├── projects/
│   │   │       └── users/
│   │   ├── api/                      # route handlers (clients/projects/users)
│   │   ├── login/                    # login page + button (client)
│   │   ├── pending-access/           # usuarios autenticados sin rol
│   │   └── auth/
│   │       ├── callback/route.ts     # OAuth exchange
│   │       └── signout/route.ts
│   ├── middleware.ts                 # protege rutas + refresh de sesión
│   ├── components/
│   │   ├── ui/                       # shadcn/ui, comiteado y ajustado a DESIGN.md
│   │   ├── calendar/                 # grilla, bloques, filtros, estados de reserva
│   │   └── *.tsx                     # app-shell, theme-toggle, status, etc.
│   ├── lib/
│   │   ├── env.ts                    # validación de env con Zod
│   │   ├── utils.ts                  # cn()
│   │   ├── api/                      # guards de route handlers + lectura de body
│   │   ├── bookings/                 # transiciones, conflictos, formulario, permisos
│   │   ├── calendar/                 # rangos, layout, ocupación, paleta, query
│   │   ├── validation/               # schemas Zod por entidad
│   │   └── supabase/                 # server/client/middleware/session helpers
│   └── types/
│       └── database.ts               # generado; regenerar con `pnpm db:types`
├── supabase/
│   ├── config.toml                   # `supabase start` local
│   ├── migrations/                   # SQL versionado
│   └── seed.sql
├── tests/
│   ├── unit/                         # Vitest sin DB ni DOM (funciones puras)
│   ├── integration/                  # Vitest contra el Supabase local (RLS, triggers)
│   ├── perf/                         # presupuestos de tiempo; corren aislados
│   └── e2e/                          # Playwright
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
- `pnpm test` — unitarios + integración (Vitest).
- `pnpm test:unit` — solo los unitarios; **no necesitan Supabase levantado**.
- `pnpm test:integration` — solo los que van contra el Supabase local.
- `pnpm test:perf` — presupuestos de tiempo. Quedan fuera de `pnpm test` a propósito: corriendo en paralelo con el resto, la misma query medía 372 ms en vez de 69, así que la aserción mediría la máquina y no el producto. Correrlos solos.
- `pnpm test:e2e` — E2E (Playwright); levanta `pnpm dev` solo si no hay uno corriendo.
- `pnpm db:push` — aplica migrations al Supabase enlazado.
- `pnpm db:reset` — recrea la DB local desde las migrations + `seed.sql`.
- `pnpm db:types` — regenera `src/types/database.ts`.

> **No corras `pnpm build` con `pnpm dev` levantado.** El build reescribe `.next/` y el dev server queda sirviendo un manifiesto viejo: los chunks dan 404, la página pierde los estilos y React no hidrata (los botones dejan de responder sin ningún error visible). Si pasa: parar el dev server, `rm -rf .next`, y volver a arrancar.

> **Si ves 404 en todos los chunks, revisá que no haya un dev server zombi.** Matar la tarea de `pnpm dev` puede dejar vivo el proceso `next dev` hijo. El síntoma es traicionero: el zombi sigue ocupando el 3000 y sirviendo HTML, el `pnpm dev` nuevo se va sin avisar a otro puerto (`Port 3000 is in use, using 3003 instead`), y el que responde en el 3000 sirve un `.next` que ya no existe — 404 en todo el JS, cero hidratación, y ningún error de servidor. Diagnóstico y arreglo:
>
> ```bash
> netstat -ano | grep LISTENING | grep ":300"   # ver quién ocupa cada puerto
> taskkill //PID <pid> //F                      # matar cada zombi
> rm -rf .next && pnpm dev                      # arrancar uno solo
> ```

---

## Convenciones de código

- **Server Components** por defecto. `"use client"` lo más profundo posible en el árbol.
- **Cliente Supabase:** `@/lib/supabase/server` en Server Components / Route Handlers; `@/lib/supabase/client` en Client Components; `@/lib/supabase/middleware` solo dentro del middleware.
- **Nunca** usar la `service_role` key desde código cliente. Solo en scripts server-side puntuales.
- **Nombres:** `kebab-case.ts` para archivos, `PascalCase` para componentes y tipos, `camelCase` para variables/funciones.

### Rutas y permisos

- Todo lo que requiere sesión vive bajo el route group `src/app/(app)/`, que resuelve el gate de sesión y el shell una sola vez. El paréntesis no aparece en la URL. Las pantallas de auth (`login`, `pending-access`, `auth/*`) quedan afuera a propósito.
- Los guards de rol se agregan como `layout.tsx` en el subárbol correspondiente (ver `(app)/admin/layout.tsx`), no repitiendo checks en cada page.
- En route handlers, la autorización pasa por `requireAdmin()` de `@/lib/api/require-admin` —o `requireBookingAccess(projectId)` para reservas—, y el payload por un schema de `@/lib/validation/`.
- **El body se lee con `readJsonBody()` de `@/lib/api/read-json`, nunca con `request.json()` directo.** `request.json()` tira ante un body vacío o mal formado, y eso sale como un 500 con stack trace: un cliente que manda basura queda registrado como una falla del servidor. El helper devuelve `undefined` y el schema lo rechaza con el 400 de siempre.
- **La sesión se pide con `getCurrentUser()` / `getCurrentProfile()`** de `@/lib/supabase/session`, nunca llamando a `supabase.auth.getUser()` directo en una page o layout. Están envueltas en el `cache()` de React y se deduplican por request: `getUser()` es un round trip HTTP al servidor de auth (~200ms medidos), y los layouts anidados lo pagaban dos veces por navegación.

### Reservas

- **Cancelar una reserva es un `update` de `status`, nunca un `delete`.** No hay borrado físico y `authenticated` no tiene el grant: la reserva cancelada sigue visible en el calendario con su tratamiento propio (`DESIGN.md` §8) y es el rastro que después audita `010`. La API no expone `DELETE` a propósito.
- **El anti doble-booking está en dos capas y ninguna reemplaza a la otra** (ADR 0008): el `exclusion constraint` es la garantía dura, y el chequeo de `findConflictingBooking()` existe para responder un 409 con la reserva que bloquea. El constraint solo excluye entre `approved`, así que **en un alta nunca se dispara** — toda reserva nace `pending`. Cualquier camino de escritura nuevo tiene que hacer el mismo chequeo.
- **Aprobar y rechazar no son del PM.** El trigger `bookings_enforce_status_transition` lo hace cumplir en la base, no solo en la API. `service_role` queda exento para que seeds y fixtures puedan sembrar estados directamente.
- **La jornada no se valida nunca.** Reservar fuera de 09:00–17:00 o en un día no laborable es excepcional pero está permitido (Q-G): se advierte en la UI con `describeBookingWarnings()` y jamás bloquea. Los schemas de Zod no conocen la jornada a propósito, para que nadie convierta la advertencia en error.

### Estado en la URL

Las vistas filtrables guardan **todo su estado en los search params**, no en React: vista, fecha, agrupación y filtros. Ver `src/lib/calendar/url.ts` y `src/lib/validation/calendar.ts`.

- Cada control de navegación es un `<Link>` que reconstruye el href conservando el resto. Así, perder un filtro al cambiar de vista es imposible por construcción, la vista es compartible por link y el botón "atrás" funciona solo.
- El parser **nunca tira**: una query string mal formada cae a los defaults. Un 500 en la pantalla principal porque alguien editó la URL sería un pésimo negocio.
- Los valores iguales al default no se escriben en la URL, para que el caso común quede corto y legible.

### Migrations

- **RLS es obligatoria** en toda tabla nueva; la migration falla el review si no la incluye.
- **Una policy sin `grant` de tabla no alcanza:** hay que otorgar los privilegios a `authenticated` / `service_role` explícitamente, o la policy deniega todo en silencio.
- **`on delete` explícito en toda FK.** La convención del proyecto:
  - Referencia **blanda** a `profiles` (PM primario, autor de una auditoría, quién invitó) → `on delete set null`. Dar de baja a un usuario nunca puede quedar bloqueado por estos vínculos.
  - Referencia **dura** (un proyecto necesita su cliente y su PM) → `on delete restrict`. El camino correcto es desactivar, no borrar.

### Vistas

- Leer `DESIGN.md` antes de crear o modificar cualquier vista, y recorrer su checklist final antes de darla por terminada.
- Los componentes de shadcn se ajustan a la escala de densidad **al instalarlos** (ver ADR 0006), no después.

---

## Estado de features

Ver `specs/features/README.md` para el índice completo y estado.

- **001-auth-and-permissions** — done. Google OAuth, roles, RLS base.
- **002-entities-admin** — done. ABM de clientes, proyectos y usuarios en `/admin/*`, invitación por email (ADR 0004), `audit_log` mínimo (ADR 0005), y el sistema de diseño de `DESIGN.md` aplicado (ADR 0006). Quedan Q-A y Q-B por confirmar con el cliente antes de `006-priority-reallocation` — ver `specs/features/002-entities-admin/tasks.md`.
- **003-calendar-ui** — done. Vistas día / mes / año en `/calendar`, agrupación por dev o proyecto, seis filtros combinables con estado en la URL, y la grilla propia sobre CSS grid (ADR 0007). Creó la tabla `bookings` de solo lectura.
- **004-bookings** — done. `bookings` ya es escribible: `exclusion constraint` anti doble-booking, policies para el PM del proyecto y el admin, API de alta / edición / cancelación, y el diálogo que se abre desde el botón o desde un click en la grilla. El anti doble-booking quedó en dos capas (ADR 0008). Q-E aplicada: mover el horario o el desarrollador de una reserva aprobada la devuelve a `pending`.
- **Próxima:** `005-approval-flow`. El desarrollador todavía no puede escribir: le falta su policy acotada a `status` sobre sus propias reservas. El trigger de transiciones ya está listo para recibirla, y al aprobar va a chocar contra el constraint — ese `23P01` hay que traducirlo (ADR 0008). Hereda además el race entre edición y aprobación (F1).
