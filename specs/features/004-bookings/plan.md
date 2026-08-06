# Plan — Bookings CRUD (con anti doble-booking)

- **ID:** 004-bookings
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

El camino de escritura de las reservas: policies de `bookings`, el `exclusion constraint` que hace imposible el doble-booking a nivel de datos, la API de alta / edición / cancelación, y el formulario que se abre desde el calendario.

La tabla ya existe: la creó `003` de solo lectura (ver `spec.md` §2.1). Esta feature le agrega lo que le falta para ser escribible, sin cambiarle el schema.

**Lo que hace crítica a esta feature es una sola línea de SQL.** Todo lo demás es CRUD conocido; el anti doble-booking es el requisito que la spec funcional §12 marca como no funcional-crítico y el único que no se puede resolver en la capa de aplicación.

---

## 2. Arquitectura

```
[formulario de reserva]  ← botón "Crear reserva" o click en la grilla
        ↓
[POST/PATCH /api/bookings] → validación Zod → advertencias de jornada (no bloquean)
        ↓
[supabase: RLS (PM del proyecto o admin) + EXCLUDE constraint]
        ↓  violación 23P01
[409 con la reserva en conflicto]
```

Sin cambios en el camino de lectura: el calendario de `003` sigue leyendo igual, y después de cada escritura se refresca con `router.refresh()`, el mismo patrón que las tablas de `002`.

---

## 3. Modelo de datos

### 3.1 Anti doble-booking (AC-4.1)

```sql
create extension if not exists btree_gist with schema extensions;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    dev_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'approved');
```

Tres decisiones dentro de esas seis líneas:

- **`where (status = 'approved')`** — solo las aprobadas se excluyen entre sí. Es AC-4.2: dos `pending` superpuestas conviven, y el conflicto se materializa recién al aprobar. Sin ese `where`, un PM no podría ni proponer un horario que otro ya propuso.
- **`btree_gist`** hace falta porque `dev_id` es `uuid` y GiST no trae operador de igualdad para uuid de fábrica. **Atención al `search_path`:** en Supabase las extensiones viven en el schema `extensions`, así que si no está en el `search_path` durante la migration, el `create constraint` falla con *"data type uuid has no default operator class for access method gist"*. La migration empieza con `set local search_path = public, extensions;`.
- **`tstzrange(starts_at, ends_at)`** usa el default `[)` — el rango incluye el inicio y excluye el fin. Es exactamente lo que queremos: una reserva de 09:00–13:00 y otra de 13:00–17:00 **no** se pisan. Con `[]` serían conflicto y el PM no podría encadenar dos bloques, que es el caso más común del día.

El constraint crea su índice GiST solo; no hay que agregarlo aparte.

**Antes de aplicarlo hay que verificar el seed.** Ya se comprobó en `003` que no hay dos reservas aprobadas superpuestas por dev (query de verificación en el historial de esa feature); si eso cambiara, la migration falla al aplicarse. Vale re-correr la verificación como primer paso.

### 3.2 Policies de escritura

La spec funcional §3 dice que el PM "crea/edita reservas **en sus proyectos**". Traducido:

```sql
create policy "bookings: pm writes on own projects"
  on public.bookings for all to authenticated
  using (public.can_manage_booking(project_id))
  with check (public.can_manage_booking(project_id));
```

con un helper `security definer` que evita repetir el subquery y no recursa sobre las policies de `projects`:

```sql
create function public.can_manage_booking(target_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'admin'
      or exists (
        select 1 from public.projects
        where id = target_project and pm_id = auth.uid()
      );
$$;
```

- **Los grants también hay que darlos:** `grant insert, update, delete on public.bookings to authenticated`. Hoy solo hay `select` (menor privilegio, decidido en `003`). Una policy sin grant deniega en silencio — la lección de `001`.
- **El dev no escribe acá.** Aprobar y rechazar es `005`, y va a necesitar su propia policy acotada a la columna `status` de sus propias reservas.
- **Cancelar es un `update` de `status`**, no un `delete`. No hay borrado físico: la reserva cancelada queda visible en el calendario con su estado (`DESIGN.md` §8) y es lo que después audita `010`.

### 3.3 Sin cambios de schema

No se agregan columnas. En particular **no** se agrega una columna de versión para R-2 (race de edición vs. aprobación): mientras el dev no pueda escribir —hasta `005`— la carrera no existe. Se resuelve en `005`, que es quien la crea, y queda anotado como follow-up de esta feature.

---

## 4. API surface

| Método | Ruta | Body | Response | Auth |
| :---- | :---- | :---- | :---- | :---- |
| POST | `/api/bookings` | `{ projectId, devId, startsAt, endsAt, note?, ticketRef? }` | `Booking` | PM del proyecto o admin |
| PATCH | `/api/bookings/[id]` | `{ startsAt?, endsAt?, devId?, note?, ticketRef? }` | `Booking` | ídem |
| PATCH | `/api/bookings/[id]` | `{ status: "cancelled" }` | `Booking` | ídem |

Mismo formato de error que `002`: `{ error, issues? }` con 400 / 403 / 409 / 500.

**Guard nuevo:** `requireBookingAccess(projectId)` en `src/lib/api/`, hermano de `requireAdmin()`. Devuelve 401 sin sesión, 403 si no es admin ni el PM del proyecto. La RLS es la que manda de verdad; el guard existe para devolver un 403 con mensaje claro en vez de un 404 silencioso de RLS.

**Traducción del conflicto (AC-1.2).** El código `23P01` (`exclusion_violation`) se traduce a 409, y **el handler busca la reserva que lo causó** para devolverla en el cuerpo: sin eso el mensaje sería "hay un conflicto" y el PM tendría que salir a buscarlo a mano.

```json
{ "error": "Cristian Soto ya tiene una reserva aprobada en esa franja",
  "conflict": { "id": "…", "startsAt": "…", "endsAt": "…", "project": "Portal de reservas" } }
```

### Q-E, respondida por el cliente (2026-08-06)

**Editar una reserva aprobada la devuelve a `pending` si cambia el horario o el desarrollador; cambiar nota o ticket no la toca.** Se implementa en el PATCH, comparando contra la fila actual. La regla vive en una función pura (`src/lib/bookings/transitions.ts`) para poder testearla sin base de datos, y `005` la va a reusar.

---

## 5. UI

### Formulario (`BookingDialog`)

Un solo componente para alta y edición, sobre el `Dialog` ya instalado. Campos: desarrollador, proyecto, fecha, hora de inicio, hora de fin, ticket, nota.

- **Se abre de dos maneras** (decidido con el usuario): el botón `Crear reserva` de la barra del calendario, y **click en un espacio libre de la grilla del día**, que precarga desarrollador (el carril) y horario (la franja). Lo segundo es el gesto que cualquiera espera de un calendario, y la grilla ya sabe qué carril y qué franja se clickeó.
- El botón `Crear reserva` es la **acción primaria de la vista** (`DESIGN.md` §7: una sola por pantalla) y salda la deuda F2 de `003`: el empty state del calendario hoy no tiene verbo.
- Al editar, el diálogo se abre desde el popover de detalle que ya existe (`booking-block.tsx`), reemplazando su rol de solo lectura.

### Advertencias sin bloqueo (AC-1.4)

Debajo de los campos de horario, en cuanto la fecha o la hora salen de la jornada: *"Fuera del horario habitual (09:00 a 17:00)"* o *"Sábado: día no laborable"*. Texto en `--attention`, inline, **sin deshabilitar el botón de guardar**. Reusa `isWorkday()` y las constantes de `src/lib/calendar/workdays.ts`, que ya existen y están testeadas.

### Conflicto (AC-1.2)

Cuando el POST devuelve 409, el error se muestra dentro del diálogo con el detalle de la reserva en conflicto y un link que navega al día donde está. Es el primer uso del componente de conflicto que `DESIGN.md` §8 dejó pendiente: icono `alert-triangle`, texto en `--danger`, y **el motivo siempre en palabras**, nunca solo el color.

### Estados de datos

El diálogo necesita el listado de desarrolladores y proyectos: se traen en el Server Component de la página, como ya hace el calendario con sus facetas.

---

## 6. Integraciones externas

Ninguna. `ticket_ref` se guarda como texto libre; el buscador de tickets de Jira es `008` y la asociación de canal de Slack es `009`. La notificación al dev (AC-2.1, AC-3.1) es de `010`: acá la reserva cambia de estado y nada más. **Conviene no simular la notificación con un toast**, para no dejar la ilusión de que el dev se enteró.

---

## 7. Dependencias entre features

- Requiere `001` (sesión y roles), `002` (proyectos y devs), `003` (la tabla, el calendario y las funciones de jornada).
- Bloquea `005` (aprobación), `006` (realocación), `007`–`009` (las integraciones necesitan reservas reales).

---

## 8. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
| :---- | :---- | :---- |
| R-1 | El constraint mal escrito deja pasar doble-booking bajo carga (de `spec.md`). | Test de concurrencia real: dos `insert` en paralelo sobre la misma franja, verificando que **exactamente uno** persiste. No alcanza con probarlos en serie: en serie pasa hasta un check aplicativo, y es justo lo que el constraint viene a reemplazar. |
| R-2 | Race entre edición y aprobación (de `spec.md`). | No existe todavía: el dev no puede escribir hasta `005`. Se traslada allá, que es quien la crea. |
| R-3 | El `search_path` de la migration no encuentra el opclass de `btree_gist` y el constraint falla al aplicarse. | `set local search_path = public, extensions;` al principio de la migration, y `supabase db reset` desde cero como parte del DoD — no basta con que ande sobre una base ya migrada. |
| R-4 | El seed o los datos existentes ya violan el constraint y la migration no aplica. | Verificar antes con el query de reservas aprobadas superpuestas; ya se corrió en `003` y daba 0 filas. |
| R-5 | Se cancela con `delete` por error, y la reserva desaparece del historial. | No se otorga `delete` a `authenticated` salvo para el caso real de borrado. Cancelar es `update status`. |

---

## 9. Alternativas consideradas

- **Validar el solapamiento en la capa de aplicación** (leer, comprobar, escribir): es lo que la spec funcional §12 descarta explícitamente, y con razón — entre el `select` y el `insert` hay una ventana en la que otro request escribe. El constraint lo hace imposible por construcción, no improbable.
- **Transacción `serializable` en vez de constraint:** resolvería la carrera, pero mueve la garantía a que *todos* los caminos de escritura recuerden usar el nivel de aislamiento correcto. El constraint no se puede olvidar.
- **Excluir también las `pending`:** más simple de explicar, pero rompe AC-4.2 y el flujo real: dos PMs necesitan poder proponerle el mismo horario al mismo dev, y que él decida.
- **Borrado físico al cancelar:** descartado. `DESIGN.md` §8 tiene un estado "cancelada" con tratamiento visual propio, y `010` necesita el rastro.

---

## 10. Testing strategy

- **Unit (sin DB):** las transiciones de estado (`transitions.ts`) — qué edición devuelve a `pending` y cuál no; el schema Zod del payload; el cálculo de advertencias de jornada sobre `workdays.ts`.
- **Integración (DB):**
  - **Concurrencia (R-1):** dos inserts en paralelo, exactamente uno sobrevive.
  - El constraint permite dos `pending` superpuestas (AC-4.2) y bloquea dos `approved` (AC-4.1).
  - Dos reservas consecutivas (09:00–13:00 y 13:00–17:00) **no** son conflicto — el borde `[)`.
  - RLS: un PM escribe en su proyecto y **no** en el de otro; un dev no escribe nada; el admin escribe en todos.
  - **Actualizar el test de `003`** que verifica que nadie escribe: esa aserción deja de valer a propósito.
- **E2E:** un PM crea una reserva desde la grilla, la ve aparecer, la edita, la cancela; y el caso de conflicto mostrando la reserva que lo bloquea.
- **Manual:** el diálogo en ambos temas, y la advertencia de fuera de horario.

---

## 11. Rollout

- Feature flag: no.
- Migraciones destructivas: no, pero **el `exclusion constraint` puede fallar al aplicarse** si los datos existentes lo violan (R-4). En un ambiente con datos reales habría que limpiar primero; hoy no hay ninguno.
- Rollback: `drop constraint` y quitar las policies revierte a la situación de `003` sin perder datos.
