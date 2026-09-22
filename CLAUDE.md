# DevsCalendar

> Plataforma de planificación de recursos para equipos de desarrollo: los PMs reservan tiempo de devs sobre proyectos, con vista de calendario tipo Google Calendar, aprobación del dev, anti doble-booking, prioridad entre proyectos e integraciones con Google Calendar, Jira y Slack.

> Antes de crear o modificar cualquier vista, leé DESIGN.md y seguilo al pie de la letra. Al terminar, verificá la checklist final.

> **El registro de deuda técnica quedó en cero el 2026-09-08.** Los nueve puntos levantados el 2026-09-07 se saldaron con `012`, `013` y una verificación manual. `docs/deuda-tecnica.md` **no se archiva**: sigue siendo el lugar donde se anota la deuda nueva, y las entradas viejas se conservan tachadas porque explican por qué el código es como es. **La regla sigue vigente para todo lo que se anote de acá en adelante: NO se salda sin OK explícito del usuario.** Leelo antes de tocar autorización o roles, las pantallas de `/admin/*`, o los handlers de `/api/clients`, `/api/projects` y `/api/users`: ahí está escrito **por qué** cada uno quedó como quedó, y varias de esas razones no se deducen del código. **Encontrar deuda nueva es bienvenido; se anota ahí y en el `tasks.md` de su feature, no se resuelve de paso.**

**Estado:** en desarrollo — features `001` a `006`, `010`, `011`, `012`, `013` y `014` terminadas; **`015`** (project membership + tickets) con Phases 1–8 en producción (panel de miembros incluido) y Phases 9–10 abiertas (tests, cierre); **`017`** (home + workspace por proyecto + tablero kanban) done; **`018`** (sprints y reporte de fin de sprint) done; **`016`** (time tracking: Mi Tiempo, Actividades por proyecto, reportes de consumo y plan-vs-real, export CSV, rol `staff`, cronómetro persistido) done. Email transaccional configurado en Vercel (2026-09-16 — `RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`).

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

## Branches

Toda feature nueva se desarrolla en **un branch propio que sale de `develop`** y **mergea de vuelta a `develop`** al terminar. `develop` es la rama integradora; `main` es la de deploy y se actualiza aparte —un push a `main` dispara Vercel (ver "Deploy")—, así que trabajar directo sobre `main` mezcla desarrollo con release.

Esto vale también cuando el trabajo lo hace la IA: si arrancás una conversación con Claude Code parado en `develop` para empezar una feature, el primer paso es crear el branch, no editar archivos. Cualquier dev que abra este repo tiene que seguir el mismo flujo.

Flujo:

1. Antes de arrancar: `git checkout develop && git pull`.
2. Crear el branch: `git checkout -b feature/NNN-<slug>`, con el mismo `NNN-<slug>` de `specs/features/`.
3. Commits, PRs y revisiones sobre ese branch.
4. Al terminar la feature: merge a `develop`. El pasaje `develop → main` es un paso separado, no parte de este flujo.

**Nada de commits directos sobre `develop` ni sobre `main`.** La única excepción son cambios que no son de una feature (typos en docs, ajustes de config puntuales), y aun así preferí un branch corto antes que ensuciar el historial de `develop` con commits sueltos.

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
├── .env.example                      # variables requeridas (desarrollo)
├── .github/workflows/tests.yml       # CI: stack efímero de Supabase + toda la suite
├── scripts/
│   ├── cleanup-test-data.mjs         # limpieza por runId de pruebas manuales
│   └── migrate-ticket-descriptions.ts # one-shot markdown → ProseMirror (019)
├── src/
│   ├── app/                          # rutas Next.js App Router
│   │   ├── layout.tsx                # fuentes + ThemeProvider
│   │   ├── globals.css               # tokens de diseño (@theme inline)
│   │   ├── (app)/                    # route group: todo lo logueado, con shell
│   │   │   ├── layout.tsx            # gate de sesión + AppShell
│   │   │   ├── error.tsx             # error boundary de la app
│   │   │   ├── page.tsx              # home landing — selector de producto (017)
│   │   │   ├── calendar/             # pantalla principal (día/mes/año)
│   │   │   ├── inbox/                # bandeja del dev: sus reservas pendientes
│   │   │   ├── my-time/              # grilla semanal de time tracking (016)
│   │   │   ├── reports/              # consumo, plan-vs-real, export CSV (016)
│   │   │   ├── projects/             # raíz del sistema de tareas (017)
│   │   │   │   ├── page.tsx          # lista de proyectos visibles
│   │   │   │   └── [projectKey]/     # workspace del proyecto
│   │   │   │       ├── layout.tsx    # header + tabs (Sprint/Backlog/Old/Actividades/Miembros)
│   │   │   │       ├── page.tsx      # redirige a /sprint (018 default)
│   │   │   │       ├── sprint/       # tab Sprint activo — kanban filtrado (018)
│   │   │   │       ├── board/        # redirect a /sprint — legacy 017
│   │   │   │       ├── backlog/      # tab backlog — TicketList con controles inline
│   │   │   │       ├── sprints/      # tab "Old Sprints" — lista + [numero]/reporte (018)
│   │   │   │       ├── activities/   # tab Actividades — CRUD por PM (016)
│   │   │   │       └── members/      # tab Miembros (015 P8)
│   │   │   ├── tickets/[key]/        # detalle flat de ticket (015)
│   │   │   ├── my-work/              # vista personal cross-project (017)
│   │   │   └── admin/                # ABM de maestros (solo admin)
│   │   │       ├── layout.tsx        # guard de rol
│   │   │       ├── clients/          # page + loading + tabla (client)
│   │   │       ├── projects/
│   │   │       └── users/
│   │   ├── api/                      # route handlers (bookings/clients/projects/users)
│   │   ├── login/                    # login page + button (client)
│   │   ├── pending-access/           # usuarios autenticados sin rol
│   │   └── auth/
│   │       ├── callback/route.ts     # OAuth exchange
│   │       └── signout/route.ts
│   ├── middleware.ts                 # protege rutas + refresh de sesión
│   ├── components/
│   │   ├── ui/                       # shadcn/ui, comiteado y ajustado a DESIGN.md
│   │   ├── calendar/                 # grilla, bloques, filtros, estados de reserva
│   │   ├── tickets/                  # tabla, filtros, badges, form-dialog (015), comments feed + editor + mention-list (022)
│   │   ├── projects/                 # project-list, workspace-header, kanban (017)
│   │   ├── home-dispatcher.tsx       # selector de producto de la home (017)
│   │   ├── sync-indicator.tsx        # provider + hook + pill flotante (017)
│   │   └── *.tsx                     # app-shell, theme-toggle, status, etc.
│   ├── lib/
│   │   ├── env.ts                    # validación de env con Zod
│   │   ├── utils.ts                  # cn()
│   │   ├── api/                      # guards de route handlers + lectura de body
│   │   ├── bookings/                 # transiciones, conflictos, formulario, permisos
│   │   ├── calendar/                 # rangos, layout, ocupación, paleta, query
│   │   ├── tickets/                  # queries, permisos, keys, url, status, facets (015), comments query (022)
│   │   ├── projects/                 # keys + workspace queries (017)
│   │   ├── sprints/                  # status labels + queries de sprint (018)
│   │   ├── editor/                   # rich text: schema, validator, renderer, editor client, viewer, hydrator, paste, convert (019), mention-suggestion + extract-mentions (022)
│   │   ├── attachments/              # types, thumb gen client-side, upload, permissions, format (020)
│   │   ├── markdown/                 # viewer + sanitize — fallback vivo hasta fase 2 (015, 019)
│   │   ├── validation/               # schemas Zod por entidad
│   │   └── supabase/                 # server/client/middleware/session helpers
│   └── types/
│       └── database.ts               # generado; regenerar con `pnpm db:types`
├── supabase/
│   ├── config.toml                   # solo para `supabase start`; ya no se usa
│   ├── migrations/                   # SQL versionado
│   └── seed.sql
├── tests/
│   ├── env.ts                        # guard: solo stack local; nunca un proyecto remoto
│   ├── run-id.ts                     # identificador por corrida y convenciones de nombres
│   ├── unit/                         # sin DB: funciones puras + Supabase mockeado
│   │   └── helpers/supabase-mock.ts  # doble del cliente
│   ├── smoke/                        # contrato con PostgREST y GoTrue (solo CI)
│   ├── integration/                  # RLS, triggers y constraints (solo CI)
│   ├── perf/                         # presupuestos de tiempo; corren aislados
│   └── e2e/                          # Playwright (solo CI)
├── specs/                            # SDD harness (spec/plan/tasks por feature)
└── docs/
    ├── deuda-tecnica.md              # deuda conocida — NO saldarla sin OK explícito
    ├── testing.md                    # estrategia de testing — leer antes de tocar tests
    └── adr/                          # architecture decision records
```

---

## Cómo correr localmente

Antes del primer run necesitás:

**La base vive en Supabase Cloud. No hace falta Docker ni `supabase start`.** El CLI viene como devDependency: se invoca `pnpm exec supabase`, nunca instalado a mano.

1. **Instalar deps:** `pnpm install`.
2. **Credenciales de desarrollo:** copiar `.env.example` a `.env.local` y completar URL + anon key del proyecto (dashboard → Settings → API).
3. **Enlazar el proyecto:** `pnpm exec supabase link --project-ref <ref>`. Sin esto, `db:push` y `db:types` no tienen a dónde ir.
4. **Aplicar migrations:** `pnpm db:push`.
5. **Habilitar Google OAuth:** en Supabase dashboard → Auth → Providers → Google. Cargar client id + secret de Google Cloud Console. Agregar la redirect URI que Supabase indica al proyecto de Google.
6. **Generar types:** `pnpm db:types`.
7. **Arrancar Next.js:** `pnpm dev`.

> **Ojo con esto: ese proyecto (`gnasmpblvarluuwtjprq`) es también el que usa el deploy de Vercel.** No hay una base de producción aparte, y **desde el 2026-09-08 esa base pasa a tener datos de gente**: se eliminaron los datos de ficción del seed y la app entra en uso. Lo que sigue dejó de ser una precaución teórica.
>
> - **`pnpm dev` en tu máquina escribe en la misma base que sirve el sitio.** Lo que crees probando a mano lo ve cualquiera que entre al deploy. Si tenés que probar con datos, usá la convención de `tests/run-id.ts` —`[test:<runId>]` en los nombres, `test-<runId>-…@example.com` en los emails— y limpiá con `node scripts/cleanup-test-data.mjs --run-id=<id>`. Sin el identificador no hay por dónde agarrar después.
> - **`pnpm db:seed` NO se corre más.** Sus catorce reservas de ficción tienen `on conflict (id) do update` (`seed.sql:212`), así que las reescribiría encima de una base con datos reales. El resto del seed es `do nothing` y no borra nada, pero eso no lo vuelve seguro: es un comando para una base vacía y esa base ya no está vacía.
> - **`pnpm db:push` es una operación sobre la base del deploy**, no un comando de desarrollo. Que la migration esté verde en CI antes es el mínimo; la regla completa está en "Migrations", más abajo, y es que **no rompa**.
>
> **Backups: configurados** (confirmado el 2026-09-08). Es la red de seguridad de todo lo de arriba y la razón por la que una sola base es un riesgo administrable y no una bomba.
>
> **Por qué no hay entornos separados, y por qué está bien por ahora** (discutido el 2026-09-08): una segunda base no elimina el riesgo de las migrations —igual hay que aplicarlas en producción algún día— sino que lo mueve. El ensayo ya existe: CI reconstruye la base entera desde las migrations en cada push. Lo que falta no es un entorno, es que las migrations no rompan, y eso se resuelve con las dos fases. Cuando el equipo crezca o el volumen lo justifique, la separación se hace igual — pero como mejora, no como emergencia.

Los tests automáticos no tocan nada de esto: corren contra un stack efímero en CI, y `tests/env.ts` rechaza cualquier URL que no sea local. Ver "Tests y bases de datos" más abajo.

Scripts útiles:

- `pnpm dev` — servidor de desarrollo.
- `pnpm build` — build de producción.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm lint` — ESLint.
- `pnpm format` — Prettier.
- `pnpm test:unit` — **lo único que corre en tu máquina**: sin base, sin credenciales, con Supabase mockeado.
- `pnpm test` — unitarios + integración. Los de integración necesitan el stack efímero, así que en la práctica esto es un comando de CI.
- `pnpm test:integration` — RLS, triggers y constraints contra el stack efímero.
- `pnpm test:smoke` — lo que solo PostgREST y GoTrue pueden confirmar: embeds, `!inner`, filtros sobre columnas embebidas.
- `pnpm test:e2e` — Playwright; levanta su propio `pnpm dev` en el **puerto 3100** apuntado al stack efímero.
- `pnpm test:perf` — presupuestos de tiempo. Fuera de `pnpm test` y fuera de CI: corriendo en paralelo con el resto, la misma query medía 372 ms en vez de 69, así que la aserción mediría la máquina y no el producto. **Sus números se calibraron contra Postgres local y hay que recalibrarlos.**
- `node scripts/cleanup-test-data.mjs --run-id=<id>` — limpieza quirúrgica de una prueba manual sobre el proyecto remoto.
- `pnpm db:push` — aplica migrations al proyecto enlazado.
- `pnpm db:seed` — migrations + `seed.sql` al proyecto enlazado. El seed es idempotente (`on conflict` en todos los inserts), así que se puede repetir.
- `pnpm db:types` — regenera `src/types/database.ts` desde el proyecto enlazado.

> **No existe `db:reset`, y es a propósito.** `supabase db reset` recrea la base **local**, que ya no usamos; el arreglo aparente es agregarle `--linked`, y eso **borra la base de la nube entera**. Si necesitás datos de cero, es `db:seed` sobre una base vacía, o recrear el proyecto desde el dashboard.

> **No corras `pnpm build` con `pnpm dev` levantado.** El build reescribe `.next/` y el dev server queda sirviendo un manifiesto viejo: los chunks dan 404, la página pierde los estilos y React no hidrata (los botones dejan de responder sin ningún error visible). Si pasa: parar el dev server, `rm -rf .next`, y volver a arrancar.

> **Si ves 404 en todos los chunks, revisá que no haya un dev server zombi.** Matar la tarea de `pnpm dev` puede dejar vivo el proceso `next dev` hijo. El síntoma es traicionero: el zombi sigue ocupando el 3000 y sirviendo HTML, el `pnpm dev` nuevo se va sin avisar a otro puerto (`Port 3000 is in use, using 3003 instead`), y el que responde en el 3000 sirve un `.next` que ya no existe — 404 en todo el JS, cero hidratación, y ningún error de servidor. Diagnóstico y arreglo:
>
> ```bash
> netstat -ano | grep LISTENING | grep -E ":3(00|10)"  # 3000 dev · 3100 tests
> taskkill //PID <pid> //F                              # matar cada zombi
> rm -rf .next && pnpm dev                              # arrancar uno solo
> ```
>
> Con los E2E en el 3100 hay **dos** servidores legítimos posibles a la vez, así que revisá los dos rangos antes de matar nada.

---

## Deploy

**El deploy lo dispara el push a `main`.** Vercel está enlazado al repo por su integración de GitHub: no hay comando que correr ni credencial que tener de este lado.

**Lo que Vercel no hace es aplicar migrations.** Buildea y sirve la app, nada más. Una feature que agrega una migration necesita `pnpm db:push` aparte, contra el proyecto de Supabase — que hoy es el mismo para desarrollo y para el sitio. **Primero la migration, después el deploy**, o el código nuevo sale a buscar algo que todavía no existe.

Las variables de entorno viven en Vercel → Settings → Environment Variables. `.env.local` no viaja nunca.

---

## Tests y bases de datos

> **Leé `docs/testing.md` antes de tocar tests, migrations o cualquier código que hable con Supabase.** Acá va solo lo obligatorio.

- **No se ejecuta Supabase ni Docker localmente.** La máquina de desarrollo no da RAM ni disco. En los runners de CI sí se usan.
- **Ningún test automático corre contra un proyecto remoto ni contra producción.** `tests/env.ts` rechaza cualquier URL que no sea local, y por eso los tests toman las credenciales del entorno del job, nunca de `.env.local`.
- **Los tests unitarios mockean Supabase** (`tests/unit/helpers/supabase-mock.ts`) y no tocan ninguna base. Son los únicos que corren en tu máquina: `pnpm test:unit`.
- **Integración, smoke y E2E usan el stack efímero de Supabase en CI**, que se levanta y se descarta dentro del job. No se pueden correr local, y está bien que así sea.
- **Los mocks no reemplazan tests de integración.** Una policy de RLS o un embed de PostgREST verificados contra un mock no están verificados.
- **No se agregan campos de testing al esquema productivo.** Los datos de prueba se identifican por convención sobre campos existentes (`[test:<runId>]`, `test-<runId>-…@example.com`); ver `tests/run-id.ts`.
- **El proyecto remoto sirve a la vez para pruebas manuales y para el deploy de Vercel** (ver la advertencia en "Cómo correr localmente"). Si dejás datos de prueba, limpialos con `node scripts/cleanup-test-data.mjs --run-id=<id>`, que exige el identificador y borra únicamente esa corrida. Nunca limpiezas globales ni truncados — y desde que el sitio está publicado, con más razón: lo que quede ahí lo ve cualquiera que entre.
- **No existe `db:reset`, y es a propósito:** resetear apuntando a un proyecto alojado borra la base entera.
- Antes de dar un cambio por terminado: `pnpm typecheck`, `pnpm lint` y `pnpm test:unit`. El resto lo verifica CI.

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
- **La home (`/`) es un dispatcher, no una redirección.** Desde `017` reemplaza al `redirect('/calendar')` que existía desde `002` — el `page.tsx` de `(app)/` renderiza `<HomeDispatcher roles={profile.roles} />` con dos–cuatro cards según rol. **No aparece como ítem del sidebar**: el acceso es por el logo/nombre del top-left, que ya linkeaba a `/` desde siempre. Cuando el usuario está en la home, ningún ítem del nav está activo — es coherente, no un bug de matching.
- **Sistema de tareas por proyecto.** Desde `017` la puerta de tickets es `/projects` (nav item "Proyectos"). Adentro de un proyecto (`/projects/[projectKey]`) el `layout.tsx` resuelve el proyecto con `getProjectByKey()` (cacheada por request) y renderiza tabs "Tablero" / "Backlog"; el `page.tsx` de la raíz del segmento hace `redirect(.../board)` para que el activo de la tab se determine por segmento del path. **El detalle de ticket sigue flat en `/tickets/[key]`** — los links viejos y los emails de `010` no se rompen. La vista personal cross-project es `/my-work` (donde vivía la tabla global de `015`).
- **`useSyncIndicator()`** de `@/components/sync-indicator` es la infra transversal para avisar trabajo asíncrono: `start(label)` devuelve `stop`, con refcount adentro del provider (dos operaciones simultáneas suman dos entradas y el pill se apaga cuando ambas terminan). Montado en `AppShell`, así que cualquier client component tiene acceso. **Usalo en vez de un `savingCount` local** cada vez que un fetch de fondo dure más que un click.

### Roles y `active`

- **El rol es un conjunto, no un valor** (`profiles.roles`, ADR 0011). Nunca se compara con `===`: se pregunta por pertenencia con `hasRole()` / `isAdmin()` / `isPm()` / `isDeveloper()` de `@/lib/auth/roles`, y en la base con `has_role()` / `has_any_role()`. Una persona puede ser PM y admin a la vez, y la navegación se arma por **unión** de lo que habilita cada rol: un `if / else if` por rol vuelve a romper el caso que `012` vino a arreglar.
- **En PostgREST, la pertenencia es `.contains("roles", ["pm"])`, nunca `.eq`.** Un filtro mal escrito typechequea igual y falla en runtime, así que los cinco call sites tienen su smoke test.
- **`has_role()` incluye `and active`, y eso es deliberado** (D-01): una policy tiene un solo tiro, y un chequeo de `active` separado se olvida solo — así nació la deuda. Con la condición adentro, todo lo que pregunte por un rol lo hereda, incluido lo que se escriba después.
- **Dos policies quedan fuera de esa regla a propósito, y no hay que "arreglarlas".** `profiles: self read` es `auth.uid() = id` sin pasar por la función: sin poder leerse a sí mismo, un usuario desactivado no puede ni ver el cartel de `/pending-access`. Y `profiles: team directory read` no filtra por `active`, porque mira la fila que se lee y no a quien lee: si desactivar a alguien lo sacara del directorio, sus reservas viejas perderían el nombre en el calendario.
- **Quedarse sin roles no es la forma de dar de baja a alguien.** El schema exige `min(1)`; el conjunto vacío existe solo para quien todavía no fue dado de alta y espera en `/pending-access`. Para dar de baja está `active`.
- **"PM puro" (`{pm}` sin `developer`) vive en `isPmOnly()`** de `@/lib/auth/roles`. El calendario lo usa para esconderlo por default (`014`); la exclusión en la query pasa por `getPmOnlyDevIds()` de `@/lib/calendar/query`. Los dos consumidores tienen que decidir igual — no re-implementar la regla en cada call site.

### Reservas

- **Cancelar una reserva es un `update` de `status`, nunca un `delete`.** No hay borrado físico y `authenticated` no tiene el grant: la reserva cancelada sigue visible en el calendario con su tratamiento propio (`DESIGN.md` §8) y es el rastro que después audita `010`. La API no expone `DELETE` a propósito.
- **Un proyecto desactivado no acepta reservas nuevas, pero sus reservas existentes se siguen pudiendo cancelar y editar** (D-08, `013`). El chequeo vive en el `with check` de `bookings: manager insert` y **no** en `can_manage_booking()`: esa función la comparten la policy de insert, la de update y `reallocate_booking()`, así que ponerlo ahí congelaría lo ya comprometido — justo lo que el PM necesita poder limpiar después de dar de baja el proyecto.
- **El anti doble-booking está en dos capas y ninguna reemplaza a la otra** (ADR 0008): el `exclusion constraint` es la garantía dura, y el chequeo de `findConflictingBooking()` existe para responder un 409 con la reserva que bloquea. El constraint solo excluye entre `approved`, así que **en un alta nunca se dispara** — toda reserva nace `pending`. Cualquier camino de escritura nuevo tiene que hacer el mismo chequeo.
- **Aprobar y rechazar no son del PM.** El trigger `bookings_enforce_status_transition` lo hace cumplir en la base, no solo en la API. `service_role` queda exento para que seeds y fixtures puedan sembrar estados directamente.
- **El desarrollador escribe sus propias reservas, pero solo `status` y `response_note` — y eso lo impone un trigger, no la policy** (ADR 0009). La policy `bookings: developer responds` es amplia a propósito: la RLS de Postgres no sabe expresar "solo estas columnas", porque `using` mira la fila vieja y `with check` la nueva, y ninguna las compara. **Quien lea solo las policies va a concluir que el dev puede reescribir cualquier columna, y va a estar equivocado:** lo que lo impide es el guard dentro de `enforce_booking_status_transition()`, que compara `to_jsonb(new) - whitelist` contra `to_jsonb(old) - whitelist`. Dos consecuencias prácticas:
  - **La whitelist es de lo escribible, no de lo prohibido.** Una columna que agregue una feature futura nace protegida; abrirla exige nombrarla ahí. El precio es que **una migration que agregue una columna a `bookings` puede romper la respuesta del dev** si esa columna viaja en el mismo `update`, y el síntoma es un `23514` inesperado.
  - **El admin no es un atajo para aprobar.** Es el único lugar de la app donde el rol admin no alcanza: el trigger compara `auth.uid()` contra `dev_id` sin mirar el rol. Aprobar no es una operación administrativa, es un compromiso sobre el tiempo de una persona. Un admin que además _es_ el dev asignado sí puede: el chequeo es de identidad.
- **La respuesta del dev viaja con `expectedUpdatedAt`, y el handler lo compara antes de escribir** (`005/plan.md` §5). Es la protección contra la carrera entre la edición del PM y la aprobación: sin ella, el dev aprueba un horario que el PM ya movió y queda comprometido con algo que nunca vio. Se ataja en dos lugares —una comparación temprana y un `.eq("updated_at", …)` en el `update`— y el segundo es el que cierra la ventana entre la lectura y la escritura.
- **La jornada no se valida nunca.** Reservar fuera de 09:00–17:00 o en un día no laborable es excepcional pero está permitido (Q-G): se advierte en la UI con `describeBookingWarnings()` y jamás bloquea. Los schemas de Zod no conocen la jornada a propósito, para que nadie convierta la advertencia en error.
- **Desplazar por prioridad no pasa por la RLS: pasa por `reallocate_booking()`, una función `security definer`** (ADR 0010). La reserva que se desplaza pertenece a **otro** proyecto, cuyo PM es otra persona, así que `bookings: manager update` la filtra — y ahí está el peligro que justifica todo el diseño: **un `update` que la RLS filtra no falla.** Afecta cero filas, sin error. Un handler que hiciera el `update` y después el `insert` respondería `201` con dos reservas aprobadas superpuestas y nada en los logs. Tres consecuencias prácticas:
  - **La policy no alcanza y no hay policy que alcance.** La regla es "podés escribir esta fila si estás creando otra de mayor prioridad que la pisa", y una policy solo ve la fila que se está tocando, no la que todavía no existe. Es el mismo límite de ADR 0009 en otra dimensión.
  - **Cualquier test de esto tiene que leer las filas de vuelta.** Mirar el código de error no distingue "funcionó" de "la RLS lo filtró en silencio", que son justo los dos mundos que hay que separar.
  - **La regla de prioridad solo juega al crear, no al aprobar.** Dos pendientes sobre la misma franja conviven —el constraint no las mira— así que si el dev aprueba primero la común, la prioritaria se queda sin franja sin que nadie haya desplazado nada. La bandeja ordena por prioridad y lo advierte (`outrankedByPending()`), pero **eso lo hace visible, no lo impide**: cerrarlo es la deuda F4 de `006/tasks.md`.

### Notificaciones

- **La fila de `notifications` la escribe un trigger, en la misma transacción que el evento** (ADR 0012). Si la reserva existe, el aviso existe: ningún camino de escritura puede saltearlo porque no depende de que un handler se acuerde. El envío del email está del otro lado de esa línea y puede fallar sin consecuencias — se retrasa, no se pierde.
- **La única excepción es `booking_displaced`, que lo escribe `reallocate_booking()`.** Esa función marca la vieja como desplazada *antes* de insertar la nueva, así que cuando el trigger corre el proyecto que se llevó la franja todavía no existe — y el aviso tiene que nombrarlo.
- **`on delete cascade` en las dos FK de `notifications`, y es un desvío deliberado de la convención de "Migrations".** Una notificación no es historia, es un mensaje: sin destinatario no significa nada y sin reserva no lleva a ningún lado. La historia la guarda `audit_log`, que por eso sí conserva `set null`.
- **El `payload` se congela al escribir; el texto no.** El trigger guarda los hechos —proyecto, franja, motivo— y las oraciones las arma `src/lib/notifications/events.ts`, así que cambiar el copy no necesita migration ni deja los avisos viejos hablando distinto que los nuevos.
- **A nadie se le avisa de su propia acción**, y el chequeo vive en un solo lugar (`notify_user()`). Con roles múltiples eso dejó de ser un caso raro.
- **Sin `RESEND_API_KEY` no se rompe nada**: las filas quedan `pending` y la bandeja in-app anda igual. Es lo que permite que CI corra sin credenciales de terceros.

### Estado en la URL

Las vistas filtrables guardan **todo su estado en los search params**, no en React: vista, fecha, agrupación y filtros. Ver `src/lib/calendar/url.ts` y `src/lib/validation/calendar.ts`.

- Cada control de navegación es un `<Link>` que reconstruye el href conservando el resto. Así, perder un filtro al cambiar de vista es imposible por construcción, la vista es compartible por link y el botón "atrás" funciona solo.
- El parser **nunca tira**: una query string mal formada cae a los defaults. Un 500 en la pantalla principal porque alguien editó la URL sería un pésimo negocio.
- Los valores iguales al default no se escriben en la URL, para que el caso común quede corto y legible.

### Migrations

- **Toda migration va en dos fases, y esto no es negociable desde que hay usuarios.** La base es la misma que sirve el deploy, así que una migration que rompe el código viejo rompe el sitio en el momento en que corre `db:push` — no cuando sale el deploy. La secuencia es:
  1. **Agregar.** La columna, tabla o función nueva convive con la vieja. El código deployado sigue funcionando sin enterarse.
  2. **Deployar** el código que usa lo nuevo.
  3. **Borrar**, en una migration posterior, lo que quedó sin usar.

  `012` se hizo en un solo paso —agregó `profiles.roles` y borró `profiles.role` en la misma migration— y el sitio quedó roto entre el `db:push` y el deploy. Fue aceptable **solo** porque todavía no había nadie adentro. Ya no es el caso.

- **Migration 19 (`019`) escribió una columna de coexistencia; su drop viene aparte en la fase 2** (feature `019.5`, F1 en `docs/deuda-tecnica.md`). El gate para saldarla es "100% de los tickets tienen `description_doc` no nulo durante ≥ 1 semana en producción, sin issues". Sin ese gate, borrar `tickets.description` breakea la ruta de fallback del `<MarkdownViewer>`.
- **RLS es obligatoria** en toda tabla nueva; la migration falla el review si no la incluye.
- **Una policy sin `grant` de tabla no alcanza:** hay que otorgar los privilegios a `authenticated` / `service_role` explícitamente, o la policy deniega todo en silencio.
- **`on delete` explícito en toda FK.** La convención del proyecto:
  - Referencia **blanda** a `profiles` (PM primario, autor de una auditoría, quién invitó) → `on delete set null`. Dar de baja a un usuario nunca puede quedar bloqueado por estos vínculos.
  - Referencia **dura** (un proyecto necesita su cliente y su PM) → `on delete restrict`. El camino correcto es desactivar, no borrar.

### Vistas

- Leer `DESIGN.md` antes de crear o modificar cualquier vista, y recorrer su checklist final antes de darla por terminada.
- Los componentes de shadcn se ajustan a la escala de densidad **al instalarlos** (ver ADR 0006), no después.

### Editor rich text

Desde `019` las descripciones de tickets son un doc de ProseMirror (`tickets.description_doc jsonb`). La columna `description` markdown queda como fallback de lectura hasta que fase 2 (feature `019.5`) la borre — es la regla de dos fases de siempre, aplicada acá porque hay usuarios.

- **`RICH_TEXT_SCHEMA` (`src/lib/editor/schema.ts`) es la única fuente de verdad de "qué es un doc válido".** La consumen tres consumidores: Tiptap, el validador Zod (`src/lib/editor/validate.ts` + `src/lib/validation/rich-text.ts`) y el renderer server (`src/lib/editor/render.ts`). Agregar un nodo o un attr nuevo se hace primero en el schema y después en los tres consumidores — no al revés. Si alguno se olvida, o entra basura (paste sanitizer), o rebota lo válido (validador), o pinta distinto (renderer).
- **El viewer del detalle es server-side** (`RichTextViewer`). Nunca importa Tiptap. El HTML lo construye `renderDocToHtml` desde el JSON validado y se inyecta con `dangerouslySetInnerHTML` — es seguro porque el string se arma acá, no viene parseado de una fuente externa. El editor client (`RichTextEditor` en `src/lib/editor/rich-text-editor.tsx`) se carga con `dynamic({ ssr: false })` desde `<TicketFormDialog>` para no meter el bundle de Tiptap (~90 KB gzipped) en la ruta del detalle.
- **`<TaskItemHydrator>`** monta checkboxes React interactivos sobre los `<span data-task-item-marker>` que emite el renderer, usando `createPortal`. Cuando el usuario clickea, arma un doc con `checked` invertido y hace `PATCH /api/tickets/:id` con `expected_updated_at` para evitar la carrera contra una edición completa. `router.refresh()` en 200 y 409 — silencio en el 409 es aceptable (edge case de dos usuarios simultáneos, `router.refresh()` corrige y se puede reintentar).
- **`<MarkdownViewer>` sigue vivo** para tickets no migrados. `<TicketDescription>` en `ticket-detail.tsx` elige: `descriptionDoc` no null → `<RichTextViewer>`; markdown no vacío → `<MarkdownViewer>` fallback; ninguno → placeholder. Cuando alguien edita un ticket no migrado, `markdownToProseMirrorDoc` convierte al vuelo (misma función que usa `scripts/migrate-ticket-descriptions.ts`) — el usuario ve el mismo resultado que si esperara al script.
- **Contributor scope es heredado, no repetido.** El trigger `enforce_ticket_contributor_scope` compara `to_jsonb(new) - {status,updated_at}` contra la vieja, así que `description_doc` nace protegida como cualquier columna nueva de tickets (ADR 0009 aplicado). No hay que tocar el trigger para agregar más columnas.
- **`audit_ticket_events` reemplaza el JSON del doc por `__changed__` en el diff** (migration 19). Sin eso cada edit escribe kilobytes en `audit_log`, y el diff no es legible de todas formas.
- **Cap de 10.000 caracteres es sobre el texto plano extraído del doc**, no sobre el JSON. Dos docs con el mismo texto pueden pesar KB muy distintos según el formato; el cap se centraliza en `RICH_TEXT_MAX_PLAIN_LENGTH` para que el contador del editor y el validador Zod usen el mismo número.

### Adjuntos (attachments)

Desde `020` los tickets pueden tener adjuntos (imágenes) en un panel propio, separado del rich text de `019`. Toda la lógica de upload, thumbs y permisos vive en `src/lib/attachments/`.

- **El thumbnail se genera en el cliente**, no en el server. `generateThumb(file)` en `src/lib/attachments/generate-thumb.ts` usa `createImageBitmap` + `OffscreenCanvas` + `convertToBlob({type:"image/webp",quality:0.8})` — max 300 px del lado mayor, sin upscale. Cero deps server, ~25 KB vs. ~3 MB del original. El upload es un solo POST multipart con `original` + `thumb` + `width` + `height`; sin ida y vuelta separado para el thumb.
- **La whitelist de tipos vive en `src/lib/attachments/types.ts`** (`ATTACHMENT_MIME_TYPES`). La consumen tres consumidores: el `<input accept=>` del panel, la validación cliente en `upload.ts`, y la validación server en el handler POST. Sumar tipos = agregar entries (ninguna migration, ningún cambio de storage) — pero decidir cómo se renderizan en el panel (imagen → thumbnail; otro → icono por tipo).
- **El bucket es privado y todo pasa por handler.** `ticket-attachments` con `public = false`. El cliente **nunca** sube ni descarga directo al bucket — el server autoriza y firma URLs de 15 min. La RLS de `storage.objects` es un espejo de `can_view_project` (via join contra `ticket_attachments`) como red final, pero el camino normal es el endpoint.
- **RLS de `ticket_attachments`:** read por `can_view_project`, insert por contributor+ del proyecto (la granularidad "puede editar este ticket puntual" vive en el handler con `canUploadAttachment`), delete por autor + PM primario + admin (`canDeleteAttachment`). Sin update — las filas son inmutables.
- **`audit_ticket_attachment_events` guarda snapshot completo en delete**, no solo el diff. Motivo: cuando un PM/admin borra un adjunto de un contributor, la fila ya no existe y el binario tampoco — el audit_log es la única evidencia. Mismo patrón que `time_entries` en 016.
- **Límite total por ticket es soft.** El contador visible al pie del panel avisa cuando pasa 50 MB pero no bloquea. El límite duro sigue siendo por archivo (5 MB, replicado en el `check` de la tabla como red final).

### Comentarios con @menciones (022)

Desde `022` los tickets tienen un feed de comentarios rich text al pie del detalle, y el editor rich text (comentarios **y** descripción) acepta el nodo `mention` con `@` autocompletado.

- **Un solo motor de rich text.** `RICH_TEXT_SCHEMA` es la fuente única de verdad — el nodo `mention` se agrega ahí y se propaga a los tres consumidores (Tiptap, validador Zod, renderer server) tal como manda 019. **No hay editor "chico" separado**: `<CommentEditor>` reusa `buildRichTextExtensions()` con placeholder distinto y sin toolbar.
- **Dos motores de `extract_mentions`, y tienen que coincidir.** La función SQL `extract_mention_user_ids(jsonb)` (migration 21, recursive CTE que camina content + marks con `coalesce + concat`) y el helper TS `src/lib/editor/extract-mentions.ts` implementan la misma semántica: caminar el árbol, recolectar `attrs.user_id` de todos los nodos `mention`, dedupe. La SQL corre en los triggers de notificación; la TS en el handler POST/PATCH para validar contra `project_members` antes de escribir. **Si aparece divergencia, arreglar las dos.** El regex UUID del cast en SQL es defensivo — el validador Zod ya lo cubre en el path normal.
- **RLS y grants de `ticket_comments`.** Read/insert por `can_view_project` (**viewer** basta — no requiere contributor, mismo criterio que Linear). Update solo autor. Delete autor + PM primario + admin. Grant `DELETE` a `authenticated` — **3ª vez en el proyecto** tras `016` y `020`; documentado. La policy de update no restringe columnas (RLS no las distingue — ADR 0009); el handler solo manda `body_doc`, así que el vector es aplicativo. Si aparece necesidad de defense-in-depth, sumar guard en trigger análogo al de `tickets` (F9 de `022/tasks.md`).
- **Dedupe estricta de destinatarios.** El trigger `notify_ticket_comment_events` inserta `ticket_mentioned` para cada mencionado y **después** `ticket_commented` para assignee/creador/PM primario **menos los ya mencionados** (spec AC-2.5). En UPDATE del `body_doc`, solo menciones **nuevas** disparan `ticket_mentioned` (comparación old vs new); sacar una mención no rescinde el aviso previo (AC-2.7).
- **Menciones en la descripción avisan también.** `notify_ticket_events` (migration 21 lo reemplaza con `create or replace`) suma dos ramas: al INSERT de un ticket con `description_doc` con menciones, y al UPDATE de `description_doc` para menciones nuevas — con `payload.source = 'description'` para que el copy del email diga "en la descripción" y no "en un comentario". El trigger escucha `description_doc` en la lista de columnas del `create trigger` (drop+create idempotente).
- **`<CommentEditor>` cargado con dynamic import.** Mismo patrón que `<RichTextEditor>` en `<TicketFormDialog>`: ~90 KB de Tiptap no viajan a la ruta del detalle hasta que el usuario abre la sección de comentarios. `Cmd/Ctrl+Enter` publica (patrón Slack/Linear); `Enter` = nuevo párrafo.
- **Sin preview del comentario en el email.** El trigger guarda `ticket_id + comment_id` en el payload; el copy del email es "Nuevo comentario en PROJ-42: '{ticket title}'" + link al `#comment-<id>`. Preview extraído del `body_doc` en dispatch quedó como F para más adelante (Postgres no garantiza orden de walker jsonb, y computarlo en TS al dispatchar suma un query por notificación).
- **Contador de comentarios en cards.** `TicketListItem.commentCount` se puebla con `comment_count:ticket_comments(count)` — embed agregado en la misma query de tickets. Cero N+1. Se muestra solo si > 0.

---

## Estado de features

Ver `specs/features/README.md` para el índice completo y estado.

- **001-auth-and-permissions** — done. Google OAuth, roles, RLS base. **D-01 y D-09 se saldaron el 2026-09-08** con `012-multiple-roles-and-active-enforcement`: los roles son un conjunto y `active` se aplica en la base. **D-02 se saldó el 2026-09-08** con `013`, junto con F7 de `003`: el desvío de AC-1.3 quedó registrado —la sesión sobrevive al login sin alta a propósito— y las policies de `select` de `clients` y `projects` dejaron de ser `using (true)`.
- **002-entities-admin** — done. ABM de clientes, proyectos y usuarios en `/admin/*`, invitación por email (ADR 0004), `audit_log` mínimo (ADR 0005), y el sistema de diseño de `DESIGN.md` aplicado (ADR 0006). Q-A y Q-B **quedaron respondidas el 2026-09-07 con el default que ya estaba aplicado** —un PM primario obligatorio; el dev es transversal— igual que el resto de las preguntas de `001` a `006`; ver `specs/features/README.md`. **D-03 a D-06 se saldaron el 2026-09-08**: el PM primario ordena el desplegable de devs (y salió de la tabla), los `<SelectValue>` dicen el texto y no el valor, y los seis handlers usan `readJsonBody()` — todo con `013`—; y D-06 se cerró con la verificación manual del usuario en el navegador, que pasó limpia.
- **003-calendar-ui** — done. Vistas día / mes / año en `/calendar`, agrupación por dev o proyecto, seis filtros combinables con estado en la URL, y la grilla propia sobre CSS grid (ADR 0007). Creó la tabla `bookings` de solo lectura.
- **004-bookings** — done. `bookings` ya es escribible: `exclusion constraint` anti doble-booking, policies para el PM del proyecto y el admin, API de alta / edición / cancelación, y el diálogo que se abre desde el botón o desde un click en la grilla. El anti doble-booking quedó en dos capas (ADR 0008). Q-E aplicada: mover el horario o el desarrollador de una reserva aprobada la devuelve a `pending`.
- **005-approval-flow** — done. El desarrollador ya escribe: policy propia sobre sus reservas, acotada a `status` y `response_note` **por un guard en el trigger, no por la policy** (ADR 0009). Bandeja en `/inbox` con guard de rol, respuesta también desde el popover del calendario, comentario obligatorio al rechazar, y las tres traducciones de error de la API — `23P01` a 409 con la reserva que bloquea, `check_violation` a 403, y `expectedUpdatedAt` desajustado a 409. Cada cambio de estado deja su fila en `audit_log`. Salió **sin notificaciones** por decisión del 2026-08-12: el dev se entera entrando a la app, y AC-1.2 / AC-3.1 se difieren a `010`.
- **006-priority-reallocation** — done. Un proyecto prioritario le toma la franja a uno común: la reserva vieja pasa a `displaced` y la nueva nace `pending`. Todo adentro de `reallocate_booking()`, una función `security definer` atómica (ADR 0010), porque la reserva que se desplaza es de otro PM y la RLS la filtraría **en silencio**. `POST /api/bookings/reallocate` con `confirmedDisplacing`, que obliga al PM a nombrar lo que acepta pisar. El empate entre prioritarios no se resuelve solo (AC-1.3) y se distingue de la prioridad insuficiente por `reason`, no por el texto. Salió **sin avisar al PM desplazado**: se entera mirando el calendario, donde `displaced` es visible por default. AC-2.1 se difiere a `010`.
  - **R-2, la deuda que dejó:** la prioridad juega al crear y no al aprobar. La bandeja del dev ordena por prioridad y advierte el choque (`outrankedByPending()`), pero eso lo hace visible, no lo impide. Ver F4 de `006/tasks.md`.
- **010-notifications-and-audit** — done. Cerró lo que `005` y `006` habían diferido: bandeja in-app con campana en el shell, email transaccional, y `audit_log` completo con `create` y `update`, que hasta acá no se registraban. Las filas las escribe un trigger en la misma transacción que el evento y el envío es un paso aparte, reintentable (ADR 0012). **Salió con `010` el gate que faltaba antes del primer usuario real.** Q-9 se respondió con **in-app + email** y no con el default de solo in-app, porque una bandeja sola no arregla "se entera si mira el calendario".
- **011-planning-view** — done. Cuarta vista del calendario (`/calendar?view=planning`): grilla de 4 semanas con **cliente > proyecto > dev** en filas y días en columnas, con la suma de horas por celda. Reusa `getBookingsInRange` y suma una segunda query **sin filtros de entidad** (`getDevDayLoad`) para la sobrecarga por dev-día — sin eso, un PM que filtra por su cliente ve a "sus" devs siempre libres cuando en realidad no lo están (R-1). Cero migrations, cero policies, cero API routes: es JS puro sobre la RLS existente. Solo lectura por diseño; la creación se queda en la vista Día. **Q-P1** cerrada con **`>8h` estricto** (jornada completa no es sobrecarga); **Q-P2** con partición por día calendario en zona local. La empty state de las cuatro vistas cambió en el mismo commit: sin filtros y sin reservas, la grilla se renderiza vacía en vez del cartel — el cartel queda para el caso filtrado, que es el único donde nombrar el filtro sí importa.
- **014-hide-pms-in-calendar** — done. El calendario esconde por default a los PM puros (`roles={pm}` sin `developer`), y un toggle "Incluir PMs" en el panel de filtros los trae de vuelta con `?includePms=1`. Sin migrations ni RLS: es un `.not("dev_id","in",…)` en `bookingsQuery` y en `getDevDayLoad`, alimentado por `getPmOnlyDevIds()` (query cacheada por request). La regla "PM puro" vive en `isPmOnly()` de `@/lib/auth/roles` para que query y dropdown decidan igual (R-1). **Selección explícita gana:** una URL con `devId=<PM>` muestra a ese PM aunque el toggle esté off, y el select lo marca con un badge para que sea obvio por qué solo se ven sus reservas.
- **015-project-membership-and-tickets** — Phases 1–7 en producción; **Phases 8 (panel de miembros en `/admin/projects/:id`), 9 (tests) y 10 (cierre) quedan abiertas.** Lo que salió: tabla `project_members` y tabla `tickets`, con enums `project_member_role` (`viewer|contributor|lead`) y `ticket_status` / `ticket_priority`. Cinco helpers `security definer` y cinco triggers (numeración correlativa `PROJ-N`, auto-add del PM como lead, inmutabilidad de `key` con tickets ya numerados, notificaciones de assign / status change, audit). API `POST/PATCH /api/tickets` y `POST/PATCH /api/project-members`. Vista global `/tickets` (movida a `/my-work` en 017), detalle flat `/tickets/[key]`, dialog de alta/edición, viewer + editor de markdown propios (`react-markdown` + `rehype-sanitize` con schema local). **La regla "el trigger es la verdad" se hereda de bookings (ADR 0009):** el guard de contributor-scope compara `to_jsonb(new) - {whitelist} = to_jsonb(old) - {...}` — cualquier columna nueva nace protegida. **Migration 15 arregla un bug del `audit_ticket_events`** que rompía todo UPDATE (`jsonb - jsonb` no existe en Postgres); anotado como F6 y como brecha de cobertura para Phase 9.
- **017-workspaces-and-boards** — done. Restructure de rutas al estilo Jira. **`/` deja de redirigir al calendario** y pasa a ser un dispatcher con dos–cuatro cards según rol (DevCalendar, Proyectos, Bandeja si dev, Administración si admin). El logo del top-left del sidebar es el único acceso a la home — no aparece como ítem del nav. El sidebar renombra "Tickets" a **"Proyectos"** (`/projects`) y suma **"Mi trabajo"** (`/my-work` — donde vivía la tabla global de 015). `/projects` lista los proyectos donde el usuario participa (admin ve todos, no-admin ve donde es PM primario o miembro activo — más restrictivo que la RLS de `projects` que sigue siendo `has_any_role()` para no romper el calendario). Adentro de un proyecto viven dos tabs: **Tablero** (kanban con `@dnd-kit`, seis columnas fijas por status, drag & drop con keyboard sensor por accesibilidad) y **Backlog** (reuso de `<TicketList>` scoped al proyecto). Detalle de ticket sigue en `/tickets/[key]` flat — links viejos y emails de `010` no se rompen. **`useState` local + rollback puntual** en el kanban en vez de `useOptimistic`: la card se queda en la columna nueva desde el drop y solo revierte si el server rechaza, sin flash — `useOptimistic` requería mantener la transition pending durante el fetch, y no lo lograba con un callback sincrónico. **`<SyncIndicatorProvider>` transversal** al `AppShell`: `useSyncIndicator().start(label)` devuelve un `stop`, refcount adentro; el pill fijo bottom-right avisa cualquier trabajo asíncrono, primero en el kanban y de acá en adelante en cualquier feature que lo necesite.
- **018-sprints-and-reporting** — done. Sprints por proyecto con ciclo `planned → active → completed`. Tabla `sprints` con **unique parcial `where status='active'`** por `project_id` — solo uno activo, garantía dura de la base. Extensiones a `tickets` (`sprint_id` FK set null, `estimated_hours numeric(5,2)`) y a `projects` (`next_sprint_number`). **Trigger de contributor-scope extendido en migration 16**: contributor no puede tocar `sprint_id` ni `estimated_hours` — es planning, no ejecución. **RPC `close_sprint_with_rollover(p_sprint_id, p_next_sprint_id)`** (`security definer`, transaccional) que compone el snapshot **antes** del update de tickets, rollea pendientes al próximo `planned`, cierra el sprint y setea `closed_at + report` — todo en una sola transacción. El check `sprints_completed_has_closed_at` garantiza que un `completed` sin snapshot no puede existir. El workspace del proyecto suma dos tabs (Sprint default, Old Sprints) y renombra el kanban existente a "Tablero completo"; el "Backlog" gana columnas Sprint (Select inline para admin/PM/lead) y Est.hs (input inline). **Solo el PM primario cierra sprints** — admin puede todo lo demás (crear, editar, activar, mover tickets) pero la firma del reporte es del owner del proyecto (AC-5.4). Rollover automático al `planned` con `starts_at` más cercano; **sin planificado siguiente, el cierre queda bloqueado** en el `<CloseSprintDialog>` que ofrece crear el próximo inline. El snapshot en `sprints.report jsonb` es inmutable — cambios post-cierre en tickets no lo modifican; la vista de reporte lo comunica al pie con "Congelado el DD/MM/YYYY".
- **020-ticket-attachments** — code done. Adjuntos (imágenes) en tickets con panel propio en el detalle, separado del rich text de 019. **Solo imágenes en el MVP** (`png/jpeg/webp/gif`, SVG excluido por XSS). Nueva tabla `ticket_attachments` con dos `object_key` (original + thumb WebP) + `width`/`height` extraídos en cliente. Bucket privado `ticket-attachments` en Supabase Storage con RLS espejo de `can_view_project`. **Thumbnails generados en cliente con Canvas → WebP ~300px** (cero deps server, ~25 KB vs ~3 MB del original — 100× menos tráfico en el panel). Upload en un solo POST multipart con original + thumb + width + height; server valida MIME/tamaño (defensa en profundidad), sube ambos objetos con `service_role`, inserta la fila con el cliente authenticated (RLS como red final), cleanup best-effort si algún paso falla. Signed URLs con expiración 15 min pedidas al server (nunca al bucket directo). **Límite total del ticket es soft** — contador visible, no bloquea (R-7 concurrencia descartado). **Sin notificaciones en el MVP** — los interesados se enteran al abrir el ticket. Permisos: uploader + PM primario + admin borran; contributor+ del proyecto suben. Trigger de audit con snapshot completo en delete (patrón `time_entries` de 016). **Fase 2 aparte** (spec futura): paste de imágenes al editor rich text de 019 — el nodo `image` del schema ya vive reservado, la fase 2 conecta el editor con esta misma infra.
- **019-ticket-rich-editor** — code done. El editor de descripción de tickets pasa de textarea markdown a rich text sobre Tiptap + ProseMirror. Doble columna en `tickets` durante la transición: `description_doc jsonb` es la fuente de verdad post-019 y `description` sobrevive como fallback de lectura hasta fase 2 (feature `019.5`, F1 pendiente). Whitelist estricta de nodos y marks en `src/lib/editor/schema.ts` — compartida por Tiptap, el validador Zod y el renderer server-side. **El viewer del detalle es server** (`renderDocToHtml` construye HTML seguro desde el JSON validado) y **el editor client se carga con `dynamic({ ssr:false })`** para no meter Tiptap (~90 KB gzipped) en la ruta de lectura. El checklist es interactivo en el detalle via `<TaskItemHydrator>` con `createPortal` y `expected_updated_at` para atajar la carrera contra ediciones. **Contributor scope heredado**: el trigger `enforce_ticket_contributor_scope` no se toca, `description_doc` nace protegida (ADR 0009). **`audit_ticket_events` reemplaza el JSON del doc por `__changed__`** en el diff genérico. Falta la ejecución del script de migración de datos (`pnpm exec tsx scripts/migrate-ticket-descriptions.ts`, coordinada con el deploy) y la verificación visual manual. Deuda nueva D-10 descubierta durante la implementación: migration fantasma `time_entries_start_time` (versión 18) en prod sin archivo local — mitigada con un stub idempotente.
- **016-time-tracking** — done. Reemplazo de TrackingTime, sin plata / sin cupos / sin ausencias. **Nuevo rol `staff`** en enum `user_role` para administración/comercial que carga horas sin ser dev (no aparece como recurso reservable en el calendario). **Tres tablas nuevas** (migration 17): `project_activities` (texto libre por proyecto, el PM define), `time_entries` (minutos múltiplos de 15 garantizado por check constraint, `ticket_id` opcional para cargar contra proyecto+actividad sin ticket específico), `active_timers` (una fila por user, PK, cronómetro persistido en DB que sobrevive al cierre del navegador). **RPCs** `stop_timer` y `stop_and_start_timer` (security definer, transaccionales) — cambio de timer con otro corriendo persiste el anterior primero. **Primera vez que la app expone `DELETE` a `authenticated`** — para `time_entries` y `active_timers`; audit_log conserva snapshot pre-borrado. **Ventana de edición de 7 días** para users (admin sin límite); enforce en handler, no en RLS. Nueva ruta **`/my-time`** con grilla semanal columnas por día (estilo TrackingTime), `<TimerPill>` en el header visible desde cualquier ruta cuando hay timer corriendo, tab **"Actividades"** en el workspace de proyecto (solo admin/PM), sección **"Horas cargadas"** en el detalle del ticket. Nueva ruta **`/reports`** (solo admin y PMs) con `/reports/consumo` (Cliente > Proyecto > Persona) y `/reports/plan-vs-real` (bookings approved vs entries cargadas). Endpoint `GET /api/time-entries/export.csv` con filtros. **Sprint report (018) enriquecido** con sección "Horas cargadas" **live-queried** al momento de abrir la página — motivo: es común cargar tarde (viernes olvidado, lunes se carga); si viviera en el snapshot inmutable, esas entries se perderían del reporte. Notificaciones (in-app + email, patrón 010): `time_entry_created_by_other` cuando alguien carga por vos, `time_entry_deleted_by_admin` cuando admin borra tu entry.
- **022-ticket-comments-and-mentions** — code done. Hilo de comentarios rich text por ticket + nodo `mention` @ habilitado en descripción y en comentarios (una sola whitelist compartida en `RICH_TEXT_SCHEMA`). Migration 21 aditiva pura: nueva tabla `ticket_comments`, extensión del check constraint de `notifications.type` con `ticket_commented` y `ticket_mentioned`, función SQL `extract_mention_user_ids(jsonb)` con recursive CTE que camina content + marks vía `coalesce + concat`, trigger `notify_ticket_comment_events` con dedupe estricta (menciones primero, stakeholders después menos ya-mencionados, patrón AC-2.5), trigger `audit_ticket_comment_events` con snapshot completo en delete (patrón 020), y `notify_ticket_events` reemplazada con `create or replace` sumando dos ramas para menciones en `description_doc` (INSERT y UPDATE con `payload.source='description'`). Helper TS `extract-mentions.ts` paralelo al SQL — los dos motores tienen que coincidir. `<CommentEditor>` reusa `buildRichTextExtensions` con placeholder distinto y sin toolbar, cargado con `dynamic({ ssr:false })` (~90 KB de Tiptap no viajan a la ruta hasta que se abra la sección). `Cmd/Ctrl+Enter` publica. RLS: viewer read/insert, autor update, autor + PM primario + admin delete (grant `DELETE` a `authenticated` — 3ª vez tras 016 y 020). Contador de comentarios en cards del backlog y del kanban vía embed agregado `comment_count:ticket_comments(count)` — cero N+1. **Sin preview del body_doc en el email en el MVP**: el trigger guarda `ticket_id + comment_id` y el copy dice "Nuevo comentario en PROJ-42: '{título}'" con link al `#comment-<id>`. Extract del preview quedó como F para más adelante — Postgres no garantiza orden de walker jsonb, y computarlo en TS al dispatchar sumaría un query por notificación. Autocompletado @: `GET /api/projects/[id]/members?q=` cap 8, `ilike` contains, `RLS-driven auth.
- **Próxima:** las tres integraciones (`007-google-calendar`, `008-jira`, `009-slack`), que ya no tienen nada delante. Ver `specs/features/README.md`.
