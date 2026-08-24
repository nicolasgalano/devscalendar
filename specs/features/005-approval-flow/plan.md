# Plan — Approval flow (dev approve/reject)

- **ID:** 005-approval-flow
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

El otro lado del flujo: hasta acá el PM propone y nadie confirma. `005` le da al desarrollador la capacidad de **responder** —aprobar o rechazar— sus propias reservas, y una bandeja donde verlas.

Es la feature que le da sentido al producto: sin respuesta del dev, una reserva es una intención del PM anotada en una grilla. También es la que **activa** el `exclusion constraint` de `004`, que hasta hoy nunca se dispara porque toda reserva nace `pending` y el constraint solo excluye entre `approved` (ADR 0008).

**Lo delicado de esta feature no es la transición, es abrir la escritura sin abrir de más.** Ver §3.2.

### Decisiones tomadas con el usuario (2026-08-12)

- **Sin notificaciones.** AC-1.2 y AC-3.1 quedan **diferidos a `010`**. El dev se entera entrando a la app. Se mantiene la regla de `004`: no se simula un aviso que no existe, porque dejaría la ilusión de que la otra persona se enteró.
- **El comentario es obligatorio al rechazar**, opcional al aprobar. Resuelve la contradicción de `spec.md` §5, que dice "opcional" y "obligatorio" en la misma línea. Un rechazo sin motivo manda al PM a preguntar por Slack, que es exactamente la fricción que el producto viene a sacar.

---

## 2. Arquitectura

```
[bandeja del dev]  ← /inbox, o el popover del bloque en el calendario
        ↓
[PATCH /api/bookings/[id]/response] → { status, note?, expectedUpdatedAt }
        ↓
[supabase: RLS (dev_id = auth.uid()) + guard de columnas + guard de transición]
        ↓  violación 23P01 (el constraint de 004, que recién acá se activa)
[409 con la reserva que bloquea]
```

Sin cambios en el camino de escritura del PM: `POST /api/bookings` y `PATCH /api/bookings/[id]` quedan como están.

---

## 3. Modelo de datos

### 3.1 Dos columnas nuevas

```sql
alter table public.bookings
  add column response_note text,
  add column responded_at timestamptz;
```

- **`response_note` es del dev, y `note` sigue siendo del PM.** Reusar `note` para el motivo del rechazo pisaría el encargo original justo cuando el PM más lo necesita: para entender qué pidió y por qué se lo rechazaron.
- **`responded_at`** separa "todavía no respondió" de "respondió hace un rato". `updated_at` no sirve para eso: lo mueve cualquier edición del PM.

### 3.2 La policy del dev, y por qué sola no alcanza

Hoy la única policy de `update` es la del PM (`can_manage_booking(project_id)`), y un dev no es el PM de su proyecto: **no puede escribir nada**. Hace falta la suya:

```sql
create policy "bookings: developer responds"
  on public.bookings for update to authenticated
  using (dev_id = auth.uid())
  with check (dev_id = auth.uid());
```

**Y acá está el riesgo central de la feature.** Las policies de un mismo comando se combinan con **OR**, así que esa policy no acota nada: le **suma** al dev la capacidad de escribir cualquier columna de sus propias filas. Con solo eso, un desarrollador podría hacer `update bookings set starts_at = ...` sobre sus reservas y **moverse sus propias horas**, que invierte la premisa del producto: el PM planifica, el dev confirma.

RLS no puede expresarlo: `with check` solo ve la fila nueva, y no existe un `with check` por columna que compare contra la vieja. Se resuelve **extendiendo el trigger que `004` ya dejó puesto**:

```sql
-- Dentro de enforce_booking_status_transition(), además del guard actual:
if auth.uid() is not null
   and auth.uid() = old.dev_id
   and not public.can_manage_booking(old.project_id)
then
  -- El dev solo responde. Todo lo demás es del PM.
  if new.project_id  is distinct from old.project_id
     or new.dev_id    is distinct from old.dev_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at   is distinct from old.ends_at
     or new.note      is distinct from old.note
     or new.ticket_ref is distinct from old.ticket_ref
  then
    raise exception 'El desarrollador solo puede aprobar o rechazar una reserva'
      using errcode = 'check_violation';
  end if;
end if;
```

El `not can_manage_booking(...)` importa: un admin que además es el dev asignado sigue pudiendo editar como admin.

### 3.3 Transiciones válidas

Solo **`pending → approved`** y **`pending → rejected`**. No se responde una reserva ya respondida:

- `approved → rejected` sería el dev desdiciéndose, que es una conversación con el PM, no un botón. Si aparece la necesidad, el camino es pedirle al PM que cancele y vuelva a proponer.
- `rejected → approved` contradice la spec funcional §5.2, que hace pasar `rejected` a "nueva reserva", no de vuelta a pendiente.

Queda como follow-up: es la clase de regla que el cliente puede querer relajar después de usarlo un mes.

### 3.4 Auditoría de la transición

`audit_log` ya existe (ADR 0005) y su patrón es el correcto: **nadie tiene `insert`**, las filas solo las escribe un trigger `security definer`, así que el log no se puede falsificar desde un cliente ni desde código de servidor distraído. `005` agrega el suyo:

```sql
create trigger bookings_log_status_change
  after update on public.bookings
  for each row execute function public.bookings_log_status_change();
```

con `entity = 'booking'`, `action = 'status_change'` y `diff = { from, to, response_note }`.

Hoy `audit_log` solo lo lee el admin. Que el PM vea el historial de su reserva es de `010`; acá el rastro se escribe y nada más.

---

## 4. API surface

| Método | Ruta | Body | Response | Auth |
| :---- | :---- | :---- | :---- | :---- |
| PATCH | `/api/bookings/[id]/response` | `{ status: "approved" \| "rejected", note?, expectedUpdatedAt }` | `Booking` | El dev asignado |

**Ruta propia, no un `status` más en el PATCH del PM.** Los dos caminos comparten la tabla y nada más: distinto guard (`dev_id = auth.uid()` vs. `requireBookingAccess(projectId)`), distinta validación (el comentario obligatorio solo existe acá) y distinto manejo de conflicto. Meterlos en un handler daría un body que significa cosas distintas según quién llame — la clase de ambigüedad que después nadie se anima a tocar.

### Tres errores que hay que traducir

1. **`23P01` → 409 con la reserva en conflicto.** Es la obligación que ADR 0008 le dejó anotada a esta feature: el constraint recién se activa acá, cuando dos `pending` superpuestas intentan volverse `approved`. Se reusa `findConflictingBooking()` de `004`. El mensaje es para el dev, no para el PM: *"Ya tenés aprobada otra reserva en esa franja"*.
2. **`check_violation` del trigger → 403**, con el motivo en palabras.
3. **`expectedUpdatedAt` que no coincide → 409** (ver §5).

---

## 5. La carrera entre edición y aprobación (F1 de `004`, R-2 de la spec)

Hoy no existe porque el dev no puede escribir. **Esta feature la crea**, así que le toca resolverla.

El escenario: el dev abre la bandeja y ve *"martes 09:00–13:00, Portal de reservas"*. Mientras decide, el PM mueve la reserva a *"jueves 14:00–18:00"* — Q-E la devuelve a `pending`, así que sigue en la bandeja, con el mismo aspecto. El dev aprueba. **Sin protección, acaba de comprometerse a un horario que nunca vio.**

**Solución: concurrencia optimista sobre `updated_at`.** La bandeja entrega el `updated_at` de cada reserva, la respuesta lo devuelve en `expectedUpdatedAt`, y el handler compara antes de escribir. Si no coincide, `409` con la reserva actualizada y un mensaje que dice que cambió.

Dos razones para esta forma y no otra:

- **No hace falta columna nueva.** `bookings_set_updated_at` lo mantiene desde `004`, en un `before update` que corre siempre, por cualquier camino de escritura.
- **Falla del lado seguro.** Si el dato es viejo, se rechaza y se le vuelve a preguntar al dev. Lo peor que produce es un clic de más; lo contrario produce un compromiso que nadie asumió.

---

## 6. UI

### Bandeja (`/inbox`)

Ruta nueva bajo el route group `(app)`, con su item de navegación **visible solo para el rol `developer`**, mismo patrón que el guard de `/admin`.

- Lista de reservas `pending` del dev ordenadas por `starts_at` (AC-1.1), en filas de 36px según la densidad de `DESIGN.md` §5.
- Cada fila: proyecto, cliente, día y franja, la nota del PM si la hay, y las dos acciones.
- **Los cuatro estados de datos** (§9). El vacío acá es buena noticia, no una carencia: *"Sin reservas para responder"*, con link al calendario en lugar de un verbo inventado.
- El badge con la cantidad de pendientes en el nav es de `010`: saber cuántas hay sin entrar ya es media notificación.

### Respuesta desde el calendario

Simétrico con lo que `004` hizo para el PM: el popover del bloque suma `Aprobar` y `Rechazar` cuando el que mira es el dev asignado y la reserva está `pending`. Reusa `BookingActionsProvider`, que ya hostea los diálogos por encima de la grilla.

### Diálogo de rechazo

El comentario es obligatorio, así que rechazar pasa siempre por un diálogo. Aprobar no: es un clic, y la fila cambia de estado al volver.

`DESIGN.md` §7 — **una sola acción primaria por vista**: en la bandeja la primaria es `Aprobar`; `Rechazar` es secundaria con texto en `--danger`.

---

## 7. Integraciones externas

Ninguna. El push a Google Calendar del approve (AC-2.1) es `007`; la notificación al PM (AC-3.1) y al dev (AC-1.2) son `010`, diferidas por decisión explícita (§1).

**No simular ninguna de las dos.** Un toast que diga "se notificó al PM" sería mentira, y de la clase que se descubre tarde y mal.

---

## 8. Dependencias entre features

- Requiere `001` (sesión y roles), `002` (proyectos y devs), `003` (calendario), `004` (la tabla escribible, el constraint, el trigger de transiciones y `findConflictingBooking`).
- Bloquea `006` (realocar necesita saber qué está aprobado), `007` (solo se pushea lo aprobado) y `009`.
- Habilita, sin necesitarla, la parte de `010` que notifica: los eventos ya quedan en `audit_log`.

---

## 9. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
| :---- | :---- | :---- |
| R-1 | **La policy del dev le abre además la edición de sus propias horas.** Las policies se combinan con OR, y `with check` no compara contra la fila vieja. | El guard de columnas del §3.2, dentro del trigger que `004` ya dejó. Test de integración explícito: el dev intenta mover su `starts_at` y falla. **Es el test que no puede faltar.** |
| R-2 | Race entre edición y aprobación (F1 de `004`). | Concurrencia optimista sobre `updated_at` (§5), con test de integración de dos escrituras intercaladas. |
| R-3 | El `23P01` sale como 500 al aprobar sobre una franja ya aprobada. | Traducción a 409 con la reserva en conflicto (§4). Es la deuda que ADR 0008 dejó nombrada. |
| R-4 | Dos aprobaciones en paralelo sobre franjas superpuestas. | El constraint las resuelve; se verifica con el mismo patrón de concurrencia real de `004` (T4.4), **en paralelo, no en serie**. |
| R-5 | La bandeja se toma por frontera de seguridad y alguien filtra solo en el cliente. | La bandeja es una **vista**, no un permiso: por Q-5 el dev lee el calendario global. Lo que protege es la policy de escritura, y eso se testea contra la RLS. |

---

## 10. Alternativas consideradas

- **Aprobar con un `PATCH` al handler existente.** Un handler con dos significados según el rol. Descartado en §4.
- **Columna `version integer` para la concurrencia.** Más explícita que `updated_at`, pero agrega una columna y un trigger para lograr lo que ya se mantiene solo.
- **Resolver la carrera mostrando un diff en vez de rechazar.** Mejor UX, bastante más superficie: hay que renderizar qué cambió y decidir qué pasa si cambia otra vez mientras se mira el diff. El 409 con "la reserva cambió, mirala de nuevo" es correcto y honesto; el diff es una mejora para `010`, cuando exista la notificación que lo acompaña.
- **Un `check constraint` para las transiciones válidas.** No puede: un `check` no ve la fila vieja. Es exactamente por eso que `004` puso un trigger.
- **La bandeja como filtro del calendario (`?status=pending&dev=yo`) en vez de vista propia.** Barato, y respeta el estado en la URL. Pero AC-1.1 pide una lista ordenada por fecha para no perderse ninguna, y una grilla de calendario es justamente mala para eso: lo que no entra en la ventana visible no existe.

---

## 11. Testing strategy

- **Unit (sin DB):** las transiciones de respuesta (`canRespond`, `nextStatusAfterResponse`) y el schema Zod, incluido el comentario obligatorio al rechazar y opcional al aprobar.
- **Integración (DB):**
  - **R-1, el que no puede faltar:** el dev **no** puede mover `starts_at`, `ends_at`, `dev_id`, `note` ni `ticket_ref` de su propia reserva; sí puede cambiar `status` y `response_note`.
  - El dev aprueba la suya; **no** puede responder la de otro; el PM sigue sin poder aprobar (regresión del guard de `004`).
  - Aprobar sobre una franja ya aprobada → `23P01`.
  - **Concurrencia (R-4):** dos aprobaciones en paralelo sobre franjas superpuestas, exactamente una persiste.
  - La fila de `audit_log` se escribe con `from`, `to` y el motivo.
  - Un admin que además es el dev asignado sigue pudiendo editar: que el guard nuevo no lo atrape.
- **E2E:** un dev entra a la bandeja, aprueba una y rechaza otra con comentario; el PM ve los dos estados en el calendario. Más el caso de la carrera: el PM edita, el dev aprueba con el dato viejo y recibe el 409.
- **Manual:** la bandeja en ambos temas, y el diálogo de rechazo.

---

## 12. Rollout

- Feature flag: no.
- Migraciones destructivas: no. Las dos columnas son nullable y el trigger extendido no toca datos existentes.
- **El orden importa: la policy del dev y el guard de columnas van en la misma migration.** Aplicar la policy sin el guard deja una ventana en la que cualquier dev puede reescribir sus propias reservas.
- Rollback: `drop policy` más revertir la función del trigger a la versión de `004`. Las columnas quedan, vacías y sin uso.
