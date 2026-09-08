# Deuda técnica registrada

> **Regla, y es dura: nada de esto se salda sin OK explícito del usuario.**
>
> Esta lista no es un backlog para ir tachando cuando sobra tiempo. Es el
> registro de lo que ya se sabe que está mal o a medias, escrito para que quien
> venga después **no lo descubra de nuevo, no lo arregle de paso, y no lo pise
> sin darse cuenta**. Si una tarea toca alguno de estos puntos, lo que
> corresponde es decirlo y preguntar — no resolverlo por iniciativa propia.
>
> D-01 a D-08 salieron el 2026-09-07 de auditar los seis `tasks.md` cerrados
> contra el código; D-09 salió el mismo día de una conversación sobre roles. Todo
> lo de acá estaba **sin documentar** en ningún lado; lo que ya estaba anotado
> como `F<n>` en su feature sigue viviendo ahí y no se duplica, salvo D-05, que
> cambió de dueño.
>
> Cuando una deuda ya tiene **decisión tomada** sobre cómo se resuelve, se dice
> explícitamente. Decidida no significa habilitada: sigue sin poder tocarse hasta
> el OK.

## Estado: las nueve están saldadas (2026-09-08)

**El registro quedó en cero.** Las nueve se saldaron en dos días y tres tandas,
todas con OK explícito:

| Cuándo | Cuáles | Con qué |
| :---- | :---- | :---- |
| 2026-09-07 | (verificación de D-06: E2E en verde + tres tests de RLS sobre `profiles`) | — |
| 2026-09-08 | D-01, D-07, D-09 | `012-multiple-roles-and-active-enforcement` |
| 2026-09-08 | D-02, D-03, D-04, D-05, D-08 | `013-registered-debt-cleanup` |
| 2026-09-08 | D-06 | verificación manual del usuario en el navegador |

**Este archivo no se archiva ni se borra.** Sigue siendo el lugar donde se anota
la deuda nueva, y las entradas de abajo se conservan tachadas a propósito: cada
una explica **por qué el código es como es**, y esa explicación vale más ahora
que la deuda no está que cuando estaba. La regla de arriba sigue vigente para
todo lo que se anote de acá en adelante.

### Contexto que dejó de ser cierto

La versión anterior de esta sección decía que la app estaba deployada pero sin
uso, y que varias deudas dejaban de ser inofensivas "el día que entre la primera
persona real". Ese día se acerca y las que importaban ya no están:

- **Backups del proyecto de Supabase: configurados** (confirmado por el usuario
  el 2026-09-08). Es la red de seguridad que faltaba nombrar mientras la base de
  desarrollo y la del deploy fueran la misma.
- **Los datos de ficción del seed se eliminan el 2026-09-08.** A partir de ahí
  `pnpm db:seed` **no se corre nunca más**: reescribiría sus catorce reservas
  fijas (`seed.sql:212`, `on conflict (id) do update`) encima de una base con
  datos de gente.
- **Lo que sigue abierto no es deuda registrada sino features:** `010`
  (notificaciones) y R-2 de `006` (la prioridad juega al crear, no al aprobar).

## Índice

| #        | Deuda                                                                                                                      | Feature | Gate                                    |
| :------- | :------------------------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------- |
| ~~D-01~~ | ~~`active = false` solo se aplica en la UI, no en la API ni en la RLS~~                                                    | 001     | **saldada 2026-09-08** (`012`)          |
| ~~D-02~~ | ~~AC-1.3 salió reinterpretada y nunca se registró el desvío~~ (con F7 de `003`)                                                                  | 001     | **saldada 2026-09-08** (`013`)  |
| ~~D-03~~ | ~~`profiles.primary_pm_id` quedó a medio implementar~~ → salida (1): orden, no filtro                                                                         | 002     | **saldada 2026-09-08** (`013`)  |
| ~~D-04~~ | ~~`SelectValue` sin hijos imprime el valor crudo en `/admin/*`~~                                                               | 002     | **saldada 2026-09-08** (`013`)  |
| ~~D-05~~ | ~~`readJsonBody()` falta en los seis handlers de `002`~~                                                                       | 002     | **saldada 2026-09-08** (`013`)  |
| ~~D-06~~ | ~~Verificar en el navegador los permisos de `/admin/*`~~ | 002     | **saldada 2026-09-08** (a mano)            |
| ~~D-07~~ | ~~El `PATCH` de reservas no chequea el `active` del desarrollador~~                                                        | 004     | **saldada 2026-09-08 con D-01** (`012`) |
| ~~D-08~~ | ~~Nada impide reservar sobre un proyecto desactivado~~                                                                         | 004     | **saldada 2026-09-08** (`013`)  |
| ~~D-09~~ | ~~Un rol por persona; nadie puede ser PM y admin a la vez~~ → resuelto con roles múltiples                                 | 001     | **saldada 2026-09-08** (`012`)          |

---

## D-01 — `active = false` solo se aplica en la UI

**Feature:** `001-auth-and-permissions` · **Gate:** antes del primer usuario real.

Desactivar a alguien le esconde la aplicación y no le saca ningún permiso.

El único lugar de todo el sistema que mira `profiles.active` en el camino de
autorización es `src/app/(app)/layout.tsx:26`, que es **un layout de UI**. No hay
layout en las rutas de API, así que nada de esto lo protege:

- `requireAdmin()` selecciona **solo `role`** (`src/lib/api/require-admin.ts:28-32`).
- `requireBookingAccess()` y `requireBookingResponder()` resuelven la sesión con
  `getCurrentProfile()`, que **trae** `active` (`src/lib/supabase/session.ts:43`)
  y que ninguno de los dos consulta.
- `src/middleware.ts:12` corre también sobre `/api/*`, pero `updateSession()`
  solo verifica que exista un `user` (`src/lib/supabase/middleware.ts:41`).

En la base pasa lo mismo, así que la RLS tampoco lo ataja:

- `current_user_role()` — `00000000000000_auth_and_profiles.sql:47`.
- `can_manage_booking()` — `00000000000006_bookings_write_path.sql:44`.
- policy `bookings: developer responds`, que es `dev_id = auth.uid()` a secas —
  `00000000000007_booking_responses.sql:38`.

**Consecuencia concreta:** un admin desactivado sigue creando clientes, proyectos
y usuarios por API; un PM desactivado sigue creando, editando y cancelando
reservas; un dev desactivado sigue aprobando las suyas. Y no hace falta una
sesión vieja guardada: volver a loguearse con Google le devuelve sesión igual, y
el middleware lo deja pasar a `/api/*`.

**Dos cosas dicen que es un descuido y no una decisión:**

1. `reallocate_booking()` **sí** chequea `active`, del proyecto y del
   desarrollador (`00000000000008_reallocation.sql:85,101`, error `DC004`). El
   camino más nuevo lo hace bien; los viejos no.
2. `001/plan.md:156` afirma que el middleware redirige "si hay sesión pero
   `role IS NULL` (o `active = false`)". Lo segundo nunca se implementó ahí.

**Por dónde se salda, cuando se dé el OK:** el chequeo de `active` en los tres
guards de `src/lib/api/`, más `and active` en `current_user_role()` y en
`can_manage_booking()`, con su migration. Ojo con el orden de esa migration: al
tocar `current_user_role()` cambia el comportamiento de **todas** las policies
que lo usan a la vez. Necesita tests de integración propios — y de los que leen
la fila de vuelta, no de los que miran el código de error (la lección de `004`
T4.2).

---

## D-02 — AC-1.3 salió reinterpretada y nunca se registró el desvío

**Feature:** `001-auth-and-permissions` · **Gate:** no bloquea.

El AC dice: "Given un login exitoso con un email que **no** está dado de alta,
then se muestra un mensaje claro y **no queda sesión iniciada**"
(`001/spec.md:35`).

Lo que se implementó deja la sesión abierta y manda a `/pending-access`
(`src/app/pending-access/page.tsx`). **Es la decisión correcta** —sin sesión no
se sabe a quién mostrarle el cartel, ni qué email nombrar— pero nunca se escribió
como desvío, así que el AC y el código dicen cosas distintas y nadie lo sabe.

Importa más de lo que parece porque es exactamente lo que vuelve alcanzable a
**F7 de `003`**: un usuario con sesión y sin rol puede leer `clients` y
`projects`, cuyas policies de `select` siguen en `using (true)`
(`00000000000001_clients_and_projects.sql:62,73`). Las dos se saldan juntas o no
se entiende ninguna.

---

## D-03 — `profiles.primary_pm_id` quedó a medio implementar

**Feature:** `002-entities-admin` · **Gate:** no bloquea.

AC-3.2 (`002/spec.md:44`) pide dos cosas y solo se hizo una:

> Given un usuario Dev, when se le asigna un PM primario (opcional), then queda
> listado como **candidato natural** para las reservas de proyectos de ese PM.

La columna existe, se edita y se valida (`00000000000002_profile_invites_and_primary_pm.sql:14`,
`src/app/api/users/[id]/route.ts:26-46`), pero **ningún otro código la lee**:
`getBookingOptions()` trae todos los devs activos ordenados por nombre sin mirarla
(`src/lib/bookings/options.ts:50-54`), y `src/lib/calendar/query.ts:340` igual.

T3.4 se marcó `[x]` porque el ABM quedó completo. La segunda mitad del AC —el
efecto sobre las reservas— nunca se implementó ni se anotó.

**Decisión del usuario del 2026-09-07:** además, **la columna "PM primario" no
debería estar en la tabla de `/admin/users`** (`users-table.tsx:179,199`). Hoy es
una columna que no alimenta ninguna decisión y le cuesta ancho a la tabla.

Las tres salidas siguen abiertas, y elegir es parte de saldar la deuda:

1. **Orden, no filtro:** en `getBookingOptions()`, primero los devs cuyo
   `primary_pm_id` sea el PM que abre el diálogo. Es lo más fiel al AC y no
   impide reservar a nadie.
2. **Filtro por defecto** en el calendario (un chip "mis devs"). Más invasivo, y
   choca con que el calendario hoy muestra al equipo entero a propósito.
3. **Sacar la columna entera** si el equipo no la usa: es una FK, una validación
   y una entrada de formulario que hay que mantener a cambio de nada.

---

## D-04 — `SelectValue` sin hijos imprime el valor crudo en `/admin/*`

**Feature:** `002-entities-admin` · **Gate:** no bloquea, pero se ve en pantalla.

Es **el mismo bug que `004` T3.1 ya encontró y arregló** en `BookingDialog`
("`SelectValue` sin hijos imprime el valor, y acá el valor es un id"). El arreglo
nunca volvió sobre las pantallas de `002`, que son donde el bug nació.

`SelectValue` es `Select.Value` de Base UI sin hijos (`src/components/ui/select.tsx:21-29`):
renderiza el `value`, no el texto del item elegido. Dónde se ve:

| Pantalla          | Select                                    | Qué muestra el trigger                              |
| :---------------- | :---------------------------------------- | :-------------------------------------------------- |
| `/admin/users`    | PM primario (`users-table.tsx:308`)       | `__none__`, o el uuid crudo del PM                  |
| `/admin/users`    | Rol, en editar (`users-table.tsx:291`)    | `developer` en vez de `Developer`                   |
| `/admin/users`    | Rol, en invitar (`users-table.tsx:263`)   | ídem                                                |
| `/admin/projects` | Prioridad (`projects-table.tsx:395`)      | `normal` / `high` en vez de `Común` / `Prioritario` |
| `/admin/projects` | Cliente (`projects-table.tsx:357`)        | el placeholder hasta elegir; después, el uuid       |
| `/admin/projects` | PM responsable (`projects-table.tsx:376`) | ídem                                                |

El de prioridad es el peor de los seis después del `__none__`: `DESIGN.md` §11
pide el vocabulario del PM y no el de la base, y el desplegable **ya** dice
`Común` / `Prioritario` en sus opciones (`projects-table.tsx:399-400`). Solo el
trigger vuelve al vocabulario de la DB.

**Cómo se resuelve, cuando se dé el OK:** resolver el texto a mano dentro de
`<SelectValue>`, como ya hacen `booking-dialog.tsx:276,307` y
`calendar-filters.tsx:194`. `ROLE_LABEL` y `pmLabel()` ya existen en
`users-table.tsx:52,58` y hoy solo se usan para la tabla.

---

## D-05 — `readJsonBody()` falta en los seis handlers de `002`

**Feature:** `002-entities-admin` · **Gate:** no bloquea.
**Antes era F5 de `004`; le corresponde a `002`, que es la dueña de las rutas.**

`CLAUDE.md` es explícito: el body se lee con `readJsonBody()`, nunca con
`request.json()` directo, porque `request.json()` tira ante un body vacío o mal
formado y eso sale como **500 con stack trace** — un cliente que manda basura
queda registrado como una falla del servidor.

Siguen los seis con la llamada directa:

- `src/app/api/clients/route.ts:11` y `src/app/api/clients/[id]/route.ts:15`
- `src/app/api/projects/route.ts:11` y `src/app/api/projects/[id]/route.ts:15`
- `src/app/api/users/route.ts:11` y `src/app/api/users/[id]/route.ts:15`

Es un cambio de una línea por handler. `004` lo arregló solo en las rutas de
reservas para no ampliar su alcance, y quedó anotado esperando "a quien toque
esas rutas" — que en un año no fue nadie.

---

## D-06 — Verificar en el navegador los permisos de `/admin/*`

**Feature:** `002-entities-admin` · **Gate:** antes del primer usuario real.

Reportado por el usuario el 2026-09-07: que cualquier usuario de la app puede
entrar a `/admin/users` y editar roles y usuarios.

**Leyendo el código, eso no es lo que dice.** El guard está en dos capas y hay un
test que lo cubre:

- `src/app/(app)/admin/layout.tsx:15` — `profile?.role !== "admin"` → `redirect("/")`.
- `src/components/app-shell.tsx:150` — `ADMIN_NAV` se agrega solo con `role === "admin"`.
- Los tres handlers pasan por `requireAdmin()`, que exige `role === "admin"`.
- `tests/e2e/admin-entities.spec.ts:140` — "redirects a non-admin away from the
  admin panel": un developer va a `/admin/clients` y termina en `/calendar`.

**Pero no alcanza para cerrar el tema, por dos motivos concretos:**

1. **Ese archivo de E2E nunca corrió en verde.** Es F6 de `004`: falla dentro de
   `createUser()`, antes de que entre el navegador, y quedó pendiente de
   re-correr "con la máquina tranquila". O sea que el test que probaría el guard
   nunca terminó de ejecutarse.
2. **Sí hay un agujero real al lado, y es D-01:** el guard mira `role` y no
   `active`. Un admin **desactivado** conserva `/admin/*` por API completo.

### Avance del 2026-09-07

**El punto 1 está cerrado: era el ambiente.** `admin-entities.spec.ts` corrió
entero y verde en [run 34140290020](https://github.com/nicolasgalano/devscalendar/actions/runs/34140290020)
—28 E2E, 28 passed— con `redirects a non-admin away from the admin panel`
pasando en 7,6s. No se tocó una línea de `createUser()`. Ver F6 de `004`.

**Y se tapó un hueco de cobertura que nadie había anotado.** La denuncia original
era "cualquiera edita roles en `/admin/users`", y la única garantía real contra
eso es la policy `profiles: admin write` (`00000000000000:81`), que **no la
cubría ningún test**: `entities-rls.test.ts` verificaba `clients`, `projects`,
`profile_invites` y `audit_log`, y se salteaba `profiles`. Se agregaron tres
casos ahí —un no-admin no edita el perfil ajeno, no se promueve a sí mismo, y un
admin sí puede—, los dos negativos **leyendo la fila de vuelta** con
`service_role`, porque un `update` que la RLS filtra devuelve `error: null`.

**El punto 2 sigue en pie y es D-01**, que se salda aparte.

**Queda solo la verificación manual en el navegador**, que ningún test
reemplaza: los E2E entran plantando la cookie de sesión a mano
(`tests/e2e/session.ts`), nunca por el login real de Google. El guion está en la
sección de abajo.

### La verificación manual pendiente, paso a paso

Hace falta **una cuenta de Google con rol `pm` y otra con rol `developer`** en el
proyecto remoto, y una sesión de admin para prepararlas. Es contra el mismo
proyecto que sirve el deploy, así que lo que se cree queda a la vista: usar la
convención de `tests/run-id.ts` para los nombres y limpiar después con
`node scripts/cleanup-test-data.mjs --run-id=<id>`.

Con **cada uno de los dos roles**, logueado de verdad por Google:

1. **La navegación no ofrece el panel.** En `/calendar`, el sidebar no muestra
   `Clientes`, `Proyectos` ni `Usuarios` (`app-shell.tsx:150`).
2. **La URL directa rebota.** Entrar a mano a `/admin/clients`, `/admin/projects`
   y `/admin/users`. Las tres tienen que terminar en `/calendar`
   (`(app)/admin/layout.tsx:15`). **`/admin/users` es la que reportó el usuario y
   la que ningún test visita con un no-admin.**
3. **La API tampoco.** Desde la consola del navegador, ya logueado:
   ```js
   await fetch("/api/users", {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ email: "test-<runId>-probe@example.com", role: "admin" }),
   }).then((r) => r.status);
   ```
   Esperado **403** por `requireAdmin()`. Repetir contra `/api/clients` y
   `/api/projects`. Un `201` acá es un bug de `002` con toda la prioridad.
4. **La base, que es la garantía de verdad.** Con la sesión del developer:
   ```js
   const { data, error } = await window.__sb
     .from("profiles")
     .update({ role: "admin" })
     .eq("id", "<su propio uuid>")
     .select();
   ```
   Esperado: `error === null` y `data.length === 0` — la RLS **filtra en
   silencio**, no falla. Después confirmar desde el dashboard de Supabase que el
   rol sigue siendo `developer`. (Si no hay un cliente de Supabase expuesto en
   `window`, este paso ya lo cubren los tres tests nuevos de
   `entities-rls.test.ts`; sirve igual como confirmación de punta a punta.)
5. **Volver a mirar el sidebar después de rebotar**, sin recargar: la nav se
   arma en el servidor, pero conviene ver que un `router.refresh()` no la
   repinte con las secciones de admin.

Si algún paso se desvía, deja de ser una verificación y pasa a ser un bug de
`002` con toda la prioridad. Si todos pasan, D-06 se cierra — y lo que queda de
riesgo en `/admin/*` es **D-01**, no esto.

### Resultado: pasó limpia (2026-09-08)

**El usuario recorrió el guion en el navegador y todos los pasos dieron lo
esperado**, con sesiones reales de Google. Ningún camino que el código no
explicara. Con eso D-06 queda saldada y el registro de deuda en cero.

Vale dejar dicho **qué era y qué no era esta deuda**, porque el nombre engaña:
nunca fue un bug. Fue un reporte —"cualquier usuario puede entrar a
`/admin/users` y editar roles"— que el código contradecía, y la respuesta
correcta no era discutirlo sino comprobarlo. La comprobación encontró dos cosas
reales de paso: que el E2E que lo probaba **nunca había corrido en verde** (era
el ambiente, no el código) y que la policy que de verdad lo impide, `profiles:
admin write`, **no la cubría ningún test**. Las dos se arreglaron. El reporte era
infundado y la revisión valió igual.

Y el riesgo que quedaba al lado —D-01, el `active` que solo se aplicaba en la
UI— ya no está: se saldó el mismo día con `012`.

---

## D-07 — El `PATCH` de reservas no chequea el `active` del desarrollador

**Feature:** `004-bookings` · **Gate:** no bloquea.

`POST /api/bookings` pide `role, active` del dev y rechaza al desactivado con un
400 (`src/app/api/bookings/route.ts:27,38-43`). El `PATCH` pide **solo `role`**
(`src/app/api/bookings/[id]/route.ts:100-104`).

O sea: no se puede _crear_ una reserva para un desarrollador desactivado, pero sí
_mover_ una existente encima de él. La asimetría no está anotada en ningún lado.
Se salda junto con D-01, que es la misma omisión en grande.

---

## D-08 — Nada impide reservar sobre un proyecto desactivado

**Feature:** `004-bookings` · **Gate:** no bloquea.

`getBookingOptions()` filtra `.eq("active", true)` sobre proyectos
(`src/lib/bookings/options.ts:44`), así que el desplegable no los ofrece — pero
ni la API ni `can_manage_booking()` (`00000000000006:44`) verifican nada. Con el
id a mano, se reserva igual.

Otra vez, `reallocate_booking()` **sí** lo chequea (`00000000000008:85`,
`DC004`). El soft delete de un proyecto es, como el de un usuario, una decisión
que hoy solo respeta la UI.

`002` AC-1.2 pide soft delete en lugar de borrado físico justamente porque hay
historial que preservar. Que desactivar no impida escribir nueva historia sobre
esa fila vacía buena parte de esa intención.

---

## D-09 — Un rol por persona, y hay gente que es PM y admin a la vez

**Feature:** `001-auth-and-permissions` · **Gate:** antes de `010`.
**Decisión tomada el 2026-09-07: se resuelve con roles múltiples.**
**Sin prerequisitos pendientes desde el 2026-09-07:** Q-A y Q-6, que eran los
dos que la trababan, están respondidas. Falta solo el OK para empezar.

`user_role` es un enum de **un solo valor**
(`00000000000000_auth_and_profiles.sql:8`), y `profiles.role` guarda uno solo. No
hay forma de modelar a alguien que sea PM y admin, y ese caso existe en el equipo.

El problema no es de permisos de operación, sino de **pertenencia**:

**Para operar reservas, `admin` ya es superconjunto de `pm`**, sobre todos los
proyectos y no solo los propios. La regla aparece cuatro veces, siempre igual:

- `can_manage_booking()` — `00000000000006_bookings_write_path.sql:44`.
- `requireBookingAccess()` — `src/lib/api/require-booking-access.ts:33`.
- `canManageProject()` — `src/lib/bookings/permissions.ts:23`.
- `getBookingOptions()` — `src/lib/bookings/options.ts:46`, que acota al PM a sus
  proyectos y al admin no lo acota.

La única excepción es **aprobar**, que es de identidad y no de rol (ADR 0009).

**Pero para _ser_ el PM responsable, el admin está excluido.** `projects.pm_id`
exige `role = 'pm'` exacto en tres lugares —`api/projects/route.ts:29`,
`api/projects/[id]/route.ts:33` y el desplegable de
`admin/projects/page.tsx:21`— y `profiles.primary_pm_id` hace lo mismo
(`api/users/[id]/route.ts:33`, `admin/users/page.tsx:19`). Es R-3 de `002`: la
regla vive **solo en la app**, porque Postgres no puede exigir que una FK apunte
a un profile con cierto rol. En la base, `pm_id` es una FK a `profiles` sin
ninguna restricción de rol.

**Consecuencia hoy:** hay que elegir uno. Con `admin` entra a `/admin/*` y opera
todo, pero ningún proyecto puede nombrarlo responsable, así que cada uno de "sus"
proyectos lleva a otra persona en `pm_id`. Con `pm` puede ser responsable pero
pierde `/admin/*` entero.

**Lo peor de eso no se ve todavía y es de `010`:** las notificaciones salen hacia
el `pm_id`. Si el responsable nominal no es quien realmente lleva el proyecto, el
aviso de "te desplazaron una reserva confirmada" le llega a la persona
equivocada — y ese aviso es justamente el gate duro antes del primer deploy con
usuarios reales.

### Cómo se resuelve

**Roles múltiples**, no el atajo de aceptar `admin` en `pm_id` (que eran cinco
líneas). Una persona podrá tener `pm` y `admin` a la vez, y "PM responsable de un
proyecto" pasa a ser una pregunta sobre si **tiene** el rol `pm`, no sobre si es
lo único que es.

Lo que toca, para dimensionarlo antes de empezar:

- **La base.** `profiles.role` singular pasa a un conjunto — array de `user_role`
  o tabla `profile_roles`. Y sobre todo **`current_user_role()`
  (`00000000000000:47`), que es la puerta de casi todas las policies** y hoy
  devuelve _un_ rol: pasa a ser una pregunta de pertenencia (`has_role('admin')`).
  Cambiarla altera de golpe el comportamiento de todo lo que la usa.
  `handle_new_user()` y `profile_invites` también asignan un rol único.
- **Los guards y las funciones puras.** `requireAdmin()`, `requireBookingAccess()`,
  `canManageProject()`, `canCreateBookings()`, `getCurrentProfile()`,
  `getBookingOptions():46`, las tres validaciones de `!== "pm"`, y el `role` con
  el que `AppShell` arma la navegación (`app-shell.tsx:146,150`), que hoy es un
  `if / else if` y pasa a ser unión.
- **La UI.** `/admin/users` cambia de un `Select` de rol a selección múltiple, y
  la columna `Rol` pasa a listar varios. Los dos desplegables de PM dejan de
  filtrar por `role = 'pm'` exacto.
- **Los ADR.** Hay que escribir uno propio, y **revisar 0009 y 0010**: los dos
  razonan sobre autorización con el rol como valor único. El guard de columnas de
  0009 no se toca —es de identidad— pero su texto sí.
- **Los tests.** `tests/e2e/session.ts:13` crea usuarios con un rol, y las
  fixtures de integración también. Hace falta el caso que hoy no se puede
  escribir: alguien con `pm` + `admin`.

### Sus dos prerequisitos ya están respondidos (2026-09-07)

Esta deuda esperaba a **Q-A** —si un proyecto puede tener varios PMs— porque una
respuesta afirmativa habría convertido la pertenencia de un proyecto en algo
distinto de un `pm_id` singular, y rediseñar roles primero y pertenencia después
es pagar la migración dos veces. **La respuesta fue que no: un PM primario
obligatorio.** `projects.pm_id` se queda como está y el diseño de roles múltiples
puede encararse solo.

El otro era **Q-6** —si el rol Cliente accede a la plataforma—, porque esta deuda
ya reescribe el enum `user_role` y sumarle un cuarto valor después sería tocarlo
por segunda vez. **La respuesta fue que no accede:** el enum se queda en `admin`,
`pm` y `developer`, y el rol Cliente sigue siendo Fase 2.

**O sea que lo único que falta para empezar es el OK explícito.** No hay ninguna
pregunta de producto pendiente detrás de esta deuda. Sigue valiendo la regla de
arriba: no se toca sin ese OK.

---

## Saldadas — 2026-09-08

**D-01, D-07 y D-09 se saldaron juntas** con la feature
`012-multiple-roles-and-active-enforcement`, con OK explícito del usuario. Las
tres entradas de arriba quedan como estaban a propósito: describen el problema
que había, y quien llegue a este archivo buscando por qué el código es como es
tiene que poder leerlo. Lo que sigue es qué cambió.

**D-09 — roles múltiples.** `profiles.role` pasó a `profiles.roles`
(`user_role[]`), `current_user_role()` se borró, y en su lugar quedaron
`has_role(user_role)` y `has_any_role()`. Las nueve policies que preguntaban por
el rol se recrearon. Alguien puede tener `pm` y `admin` a la vez, y **ser el
`pm_id` de un proyecto**, que era la mitad que faltaba: `010` ya puede notificar
a quien realmente lleva el proyecto. Ver ADR 0011.

**D-01 — `active` con dientes.** El chequeo entró **adentro** de `has_role()`, no
al lado: una policy tiene un solo tiro, y una condición separada se olvida sola
—que es exactamente cómo nació esta deuda—. Con eso, las siete policies que
preguntan por un rol heredan el chequeo, y también lo hereda lo que se escriba
después. Los tres guards de `src/lib/api/` lo miran para devolver un 403 legible
en vez de un resultado vacío.

Dos excepciones deliberadas, cada una con su test: **`profiles: self read`** no
pasa por las funciones nuevas —sin poder leerse a sí mismo, un desactivado no
puede ni ver el cartel de `/pending-access`— y **`profiles: team directory read`**
no suma `active`, porque filtra la fila que se lee y no a quien lee: si
desactivar a alguien lo sacara del directorio, sus reservas viejas perderían el
nombre en el calendario.

**D-07 — el `PATCH` de reservas.** Entró en el mismo cambio, como decía su propia
entrada. El `select` del handler pedía solo el rol; ahora pide `roles, active` y
rechaza al desactivado, igual que el `POST`.

**Lo que sigue abierto y es de la misma familia: D-08.** Nada impide reservar
sobre un proyecto desactivado. No se tocó porque nunca estuvo anotada como parte
de D-01 y no se saldan deudas de paso. Con `can_manage_booking()` ya reescrita,
es un chequeo más adentro de esa función.

**Y lo que esto le deja a D-06:** la verificación manual en el navegador sigue
pendiente, y ahora tiene un caso más que valía la pena probar de todos modos —un
usuario desactivado— que el E2E nuevo ya cubre automáticamente.

---

## Saldadas — 2026-09-08, segunda tanda

**D-02, D-03, D-04, D-05 y D-08** se saldaron con
`013-registered-debt-cleanup`, con OK explícito. Quedaba D-06 y nada más — y esa
misma tarde el usuario la cerró a mano, así que **el registro quedó en cero**.

**D-02 y F7 de `003`, que eran la misma cosa.** El desvío de AC-1.3 quedó
registrado en `001/spec.md`: la sesión sobrevive al login sin alta **a
propósito**, porque sin sesión no se sabe a quién mostrarle el cartel de
`/pending-access` ni qué email nombrar. Y su consecuencia se cerró: las policies
de `select` de `clients` y `projects` pasaron de `using (true)` a
`has_any_role()`, así que completar el OAuth de Google dejó de ser, por sí solo,
acceso a la lista de clientes y proyectos de la empresa. Las cuatro tablas
—`bookings`, `profiles`, `clients`, `projects`— quedaron detrás del mismo
criterio.

**D-03 — se eligió la salida (1) de las tres que la entrada dejaba escritas:
orden, no filtro.** `getBookingOptions()` pone primero a los devs que tienen al
PM que abre el diálogo como PM primario. **Nadie desaparece de la lista**, que es
la mitad que importa: el AC dice "candidato natural", no "único candidato", y
Q-B ya había respondido que el dev es transversal. Al admin no se le reordena: no
tiene devs propios. Y la columna "PM primario" salió de la tabla de
`/admin/users`, como el usuario había pedido; el campo sigue en el diálogo.

**D-04 — los cuatro que quedaban.** `012` se había llevado dos al matar el
`Select` de rol. Los otros cuatro —PM primario, cliente, PM responsable y
prioridad— ahora resuelven el texto adentro de `<SelectValue>`. El de prioridad
era el peor: sus opciones ya decían `Común` y `Prioritario`, y solo el trigger
volvía al vocabulario de la base.

**D-05 — `readJsonBody()` en los seis handlers.** Un body vacío o mal formado
responde 400 y deja de registrarse como una falla del servidor.

**D-08 — un proyecto desactivado no acepta reservas nuevas.** El chequeo vive en
el `with check` de `bookings: manager insert`, **no** en `can_manage_booking()`,
y esa es la decisión de diseño que importa: esa función la comparten la policy de
insert, la de update y `reallocate_booking()`, así que ponerlo ahí habría
congelado también las reservas existentes del proyecto dado de baja — justo lo
que su PM necesita poder cancelar. Desactivar bloquea historia nueva; no congela
la vieja. Hay un test para cada mitad.

### Cómo terminó D-06

**Saldada el 2026-09-08**, con la pasada manual del usuario en el navegador —
todos los pasos como esperado. Ver el resultado completo en la sección de D-06.

Lo que la sostiene de acá en adelante, para que no haya que volver a hacerla a
mano cada vez que se toque `/admin/*`:

- El E2E de un developer contra `/admin/clients` (verde desde el 2026-09-07).
- Tres casos de RLS sobre `profiles` (2026-09-07).
- Un admin **desactivado** que rebota y recibe 403 (`012`).
- Un **PM** contra las tres pantallas de `/admin/*` y los tres handlers (`013`).

Lo único que esos tests no pueden replicar es el login en sí: las fixtures
plantan la cookie de sesión (`tests/e2e/session.ts`) en vez de pasar por el OAuth
de Google. Por eso hizo falta una persona una vez — y por eso, si algún día
cambia el guard de `/admin/*`, conviene repetir el guion en vez de confiar solo
en la suite.
