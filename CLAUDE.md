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

Top-level (para el detalle, `ls` o explorar el repo):

- `src/app/` — rutas Next.js App Router. Todo lo logueado vive bajo el route group `(app)/` (gate de sesión + shell una sola vez; el paréntesis no aparece en URL). Las pantallas de auth (`login`, `pending-access`, `auth/*`) quedan afuera a propósito.
- `src/app/api/` — route handlers (bookings, tickets, projects, clients, users, time-entries, project-members, attachments, comments).
- `src/components/` — `ui/` (shadcn comiteado y ajustado a DESIGN.md); por dominio (`calendar/`, `tickets/`, `projects/`) y transversales (`app-shell`, `sync-indicator`, `theme-toggle`, `home-dispatcher`).
- `src/lib/` — por dominio: `supabase/` (server/client/middleware/session), `api/` (guards + `readJsonBody`), `auth/`, `bookings/`, `calendar/`, `tickets/`, `projects/`, `sprints/`, `editor/` (rich text + mentions), `attachments/`, `markdown/` (fallback), `notifications/`, `reports/` (helper + serializers CSV/XLSX de 021), `validation/` (Zod).
- `src/middleware.ts` — protege rutas + refresh de sesión.
- `src/types/database.ts` — generado; regenerar con `pnpm db:types`.
- `supabase/migrations/` — SQL versionado. `config.toml` existe pero ya no se usa (local Docker abandonado).
- `tests/` — `unit/` (único que corre local, Supabase mockeado); `smoke/` + `integration/` + `e2e/` + `perf/` (solo CI). `env.ts` rechaza URLs no-locales; `run-id.ts` para datos de prueba manual.
- `specs/features/NNN-<slug>/` — SDD harness (spec + plan + tasks por feature). `specs/features/README.md` es el índice vivo.
- `docs/` — `deuda-tecnica.md` (no saldar sin OK), `testing.md`, `adr/` (decisiones de arquitectura).
- `scripts/` — `cleanup-test-data.mjs` (limpieza por runId), `migrate-ticket-descriptions.ts` (one-shot markdown→ProseMirror).

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
- **`ticket_status_changed` avisa a tres destinatarios**: assignee (015), creador (015) y **PM primario del proyecto** (023). La dedupe entre ellos es explícita con `distinct from` en tres direcciones — cuando el PM coincide con assignee o creador, no se duplica la fila. Solo `status`; `ticket_assigned` sigue avisando solo al asignado nuevo.
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

Ver `specs/features/README.md` para el índice vivo con status, pendientes y gates por feature. Las entradas de abajo son solo el titular — para el "por qué" entrá a `specs/features/NNN/`.

- **001-auth-and-permissions** — done. Google OAuth, roles como conjunto (`profiles.roles`), RLS base con `has_role()` / `has_any_role()`.
- **002-entities-admin** — done. ABM de clientes, proyectos y usuarios en `/admin/*`, invitación por email, `audit_log` mínimo (ADRs 0004-0006).
- **003-calendar-ui** — done. Vistas día/mes/año en `/calendar`, grilla propia sobre CSS grid (ADR 0007), seis filtros con estado en URL.
- **004-bookings** — done. Escritura de reservas con anti doble-booking en dos capas (ADR 0008). Mover horario o dev de una `approved` la vuelve a `pending`.
- **005-approval-flow** — done. El dev responde desde `/inbox` o popover; alcance acotado por guard en trigger (ADR 0009), no por policy. `expectedUpdatedAt` ataja la carrera contra la edición del PM.
- **006-priority-reallocation** — done. Prioridad desplaza vía `reallocate_booking()` security definer (ADR 0010), porque un `update` que la RLS filtra no falla. Deuda R-2 abierta: la prioridad juega al crear, no al aprobar — la bandeja lo advierte pero no lo impide (F4 de `006/tasks.md`).
- **010-notifications-and-audit** — done. Cerró lo que `005` y `006` difirieron: bandeja in-app + email transaccional + audit_log completo. Trigger escribe en misma tx que el evento; envío es paso aparte reintentable (ADR 0012).
- **011-planning-view** — done. Cuarta vista `/calendar?view=planning`: grilla de 4 semanas con cliente>proyecto>dev. Suma segunda query sin filtros (`getDevDayLoad`) para que la sobrecarga por dev-día sea global, no afectada por filtros del PM.
- **014-hide-pms-in-calendar** — done. Calendario esconde PMs puros por default; toggle `?includePms=1`. Selección explícita gana: `devId=<PM>` lo muestra aunque el toggle esté off.
- **015-project-membership-and-tickets** — Phases 1–8 en prod (panel de miembros incluido); **Phases 9 (tests) y 10 (cierre) abiertas**. Tablas `project_members` + `tickets`, numeración correlativa `PROJ-N` por trigger, contributor-scope heredado (ADR 0009). Deuda F6: cobertura de triggers.
- **017-workspaces-and-boards** — done. Restructure estilo Jira: `/` dispatcher con cards por rol, `/projects/*` workspace por proyecto, `/my-work` cross-project. Kanban con `@dnd-kit` + rollback puntual. `<SyncIndicatorProvider>` transversal al `AppShell`.
- **018-sprints-and-reporting** — done. Sprints por proyecto con ciclo `planned → active → completed`. Unique parcial garantiza un solo activo. RPC `close_sprint_with_rollover()` transaccional congela snapshot en `sprints.report jsonb` (inmutable); rollover automático al próximo `planned`.
- **016-time-tracking** — done. `/my-time`, `/reports/consumo` y `/reports/plan-vs-real`, export CSV. Nuevo rol `staff`. `active_timers` persiste el cronómetro en DB. Primera vez que la app expone `DELETE` a `authenticated` (`time_entries` + `active_timers`); audit guarda snapshot pre-borrado.
- **019-ticket-rich-editor** — code done. Descripciones a ProseMirror (`tickets.description_doc jsonb`); `description` markdown vive como fallback hasta fase 2 (feature `019.5`, F1 pendiente). Viewer server-side; editor cliente con `dynamic({ssr:false})`. Deuda D-10: migration fantasma 18 mitigada con stub idempotente.
- **020-ticket-attachments** — code done. Adjuntos de imagen con thumb WebP generado en cliente, bucket privado `ticket-attachments` + signed URLs 15 min. Límite total soft; audit guarda snapshot en delete. Fase 2 (paste al editor) queda aparte.
- **022-ticket-comments-and-mentions** — code done. Hilo de comentarios rich text + nodo `mention` compartido con descripción (misma whitelist). Dos motores de `extract_mentions` (SQL + TS) tienen que coincidir. Grant `DELETE` a `authenticated` por 3ª vez tras 016/020. Deuda F9: guard en trigger de `ticket_comments` para defense-in-depth.
- **023-notify-pm-on-status-change** — done. `ticket_status_changed` ahora avisa también al PM primario con dedupe explícita (`distinct from` en tres direcciones) entre assignee / creador / PM.
- **021-time-tracker-tasks-and-export** — code done. Rename cosmético UI "Actividad" → "Tarea" (el schema sigue en `project_activities`, segmento URL `/activities` e identificadores de código preservados — un test guardrail scaneando `.tsx` sin comentarios protege contra regresión). Reporte "planilla" con 11 columnas en español alineadas con la planilla comercial de referencia (sin USD/facturable); mismo pipeline sirve CSV y XLSX, con `exceljs` dynamic-imported para no pagar cold start del resto del server bundle.
- **Próxima:** las tres integraciones (`007-google-calendar`, `008-jira`, `009-slack`), que ya no tienen nada delante. Ver `specs/features/README.md`.
