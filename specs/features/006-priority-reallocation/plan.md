# Plan — Priority & reallocation

- **ID:** 006-priority-reallocation
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `004-bookings`, `005-approval-flow`

---

## 1. Resumen técnico

**No hay cambios de esquema.** Los tres ingredientes ya existen:

- `projects.priority` es `normal | high` desde `002` (migration 1).
- `displaced` ya está en el `check` de `bookings.status` desde `004` (migration 4).
- `bookings` **no copia** la prioridad: se resuelve por join contra `projects`, decisión explícita de `004` para no tener que sincronizarla en cada cambio de prioridad. Sigue siendo la correcta, y `006` la aprovecha: desplazar no requiere tocar ninguna columna nueva.

Toda la feature es, entonces, **una función en la base y la UI que la ofrece**. Y la función existe por un problema concreto que hay que entender antes de leer el resto: §3.2.

### Decisiones heredadas que no se re-discuten

- **El dev siempre aprueba** (Q-1 de la spec funcional, Q-6 del índice). Una reserva creada por realocación nace `pending` como cualquier otra (AC-3.1).
- **La desplazada no se restaura** si la prioritaria después se cancela o se rechaza (AC-3.2, Q-G). El PM anterior reasigna a mano.
- **Sin notificaciones**, igual que `005`: AC-2.1 y AC-2.2 dependen de `010`. Ver §7.

---

## 2. Arquitectura

```
supabase/migrations/
  00000000000008_reallocation.sql   función reallocate_booking() + grants

src/lib/bookings/
  priority.ts        reglas puras: quién desplaza a quién, y qué se puede desplazar
  conflicts.ts       (004) se amplía: el conflicto ahora dice si es desplazable

src/app/api/bookings/reallocate/
  route.ts           POST — crear desplazando, con confirmación explícita

src/components/calendar/
  booking-dialog.tsx (004) el 409 de conflicto gana un camino: "Desplazar y reservar"
  booking-displace.tsx  diálogo de confirmación de la realocación
```

---

## 3. Modelo de datos

### 3.1 Sin cambios de esquema

Nada que migrar en las tablas. Lo único que agrega la migration es una función y sus grants.

### 3.2 El problema central: el PM prioritario no puede tocar la reserva ajena

Es lo primero que hay que resolver y no es evidente hasta que se mira la policy de `004`:

```sql
create policy "bookings: manager update"
  on public.bookings for update to authenticated
  using (public.can_manage_booking(project_id))
  with check (public.can_manage_booking(project_id));
```

`can_manage_booking(target_project)` es **admin, o el PM de ese proyecto**. La reserva que hay que desplazar pertenece al **proyecto común**, cuyo PM es otra persona. Así que el PM prioritario **no matchea el `using`**, y ahí está lo peligroso:

> **Un `update` que la RLS filtra no falla: no hace nada.** Cero filas afectadas, sin error. La API respondería `201` con la reserva nueva creada y la desplazada seguiría `approved`, intacta. El resultado sería **dos reservas aprobadas superpuestas** —lo único que la spec funcional §12 marca como no negociable— sin un solo mensaje de error.

Es exactamente el R-1 de la spec ("reservas críticas caídas sin dejar rastro"), y es el modo de falla por defecto si esto se implementa sin pensarlo. La lección de `004` T4.2 y de `005` T3.2 aplica igual acá: **verificar leyendo la fila de vuelta, nunca solo por el error.**

### 3.3 `reallocate_booking()`: una función `security definer`, y por qué

```sql
create function public.reallocate_booking(
  target_project uuid,
  target_dev uuid,
  starts timestamptz,
  ends timestamptz,
  booking_note text default null,
  ticket text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
```

Devuelve `{ booking: <la nueva>, displaced: [<las que desplazó>] }`.

**Por qué una función y no una policy.** La regla es "podés escribir esta fila **si estás creando otra de mayor prioridad que la pisa**". Una policy solo ve la fila que se está tocando; no tiene forma de conocer la reserva nueva, que ni siquiera existe todavía. No es una limitación que se pueda rodear con un `using` más ingenioso: es la misma clase de límite que ADR 0009 ya documentó para la autorización por columna.

**Por qué `security definer` y no `service_role` desde el handler.** `CLAUDE.md` prohíbe la `service_role` key fuera de scripts puntuales, y con razón: desde un route handler apagaría la RLS para **todo** lo que ese request toque. La función definer apaga la RLS solo adentro de su propio cuerpo, y ahí adentro impone sus propias reglas.

**Por qué atómica.** Crear la nueva y desplazar la vieja tienen que pasar o fallar juntas. Dos requests separados dejarían, si el segundo falla, o una reserva nueva encima de una aprobada, o una reserva desplazada sin nada que la reemplace. Las dos son peores que no haber hecho nada.

**Lo que la función chequea adentro, en orden:**

1. **Que quien llama sea el PM del proyecto nuevo** (o admin) — `can_manage_booking(target_project)`. Sin esto, `security definer` sería una puerta abierta a crear reservas en cualquier proyecto.
2. **Que el dev exista y esté activo**, como hace el alta de `004`.
3. **Qué reservas `approved` del mismo dev se superponen**, con la misma condición del constraint (`starts_at < ends and ends_at > starts`, borde `[)`).
4. **Que todas sean desplazables** por la regla de §5. Si alguna no lo es, la función **tira** y no escribe nada.
5. Recién ahí: `update … set status = 'displaced'` sobre las viejas, `insert` de la nueva en `pending`.

### 3.4 Auditoría: el rastro tiene que decir _por qué_

`bookings_log_status_change` (de `005`) ya registra **todo** cambio de estado, así que el paso a `displaced` deja su fila sola. Pero su `diff` de hoy es `{from, to, response_note}`, y para una realocación eso no alcanza: no dice **qué reserva la desplazó**.

Hay que ampliarlo. La opción limpia es que la función escriba su propia fila con `action = 'reallocated'` y un diff con `{ displaced_by, project, actor }`, **además** de la que deja el trigger. Dos filas por el mismo evento, a propósito: una cuenta el cambio de estado y la otra la decisión, y `010` va a querer leerlas distinto.

La alternativa —enseñarle al trigger a mirar de dónde viene el cambio— lo obligaría a conocer el contexto de quien lo llama, que es justo lo que un trigger no debería necesitar.

---

## 4. API surface

| Método | Ruta                       | Body                                                   | Response                 | Auth                  |
| :----- | :------------------------- | :----------------------------------------------------- | :----------------------- | :-------------------- |
| POST   | `/api/bookings/reallocate` | Igual que el alta, más `confirmedDisplacing: string[]` | `{ booking, displaced }` | PM del proyecto nuevo |

**Ruta propia y no un flag en `POST /api/bookings`**, siguiendo el precedente de `005`. Tres motivos, y el tercero es el que decide:

1. La respuesta tiene **otra forma**: además de la reserva creada, devuelve la lista de las que desplazó. El PM tiene que enterarse de lo que acaba de hacer.
2. Tiene modos de falla propios —empate de prioridad, prioridad menor— que el alta normal no conoce.
3. **`confirmedDisplacing` obliga a que el cliente nombre las reservas que acepta pisar.** Si en el momento de escribir aparece una que no estaba en esa lista, la operación se rechaza. Es la misma idea que el `expectedUpdatedAt` de `005`: entre que el PM ve el conflicto y confirma, el mundo puede cambiar, y desplazar algo que nunca vio es exactamente lo que esta feature no puede hacer.

### Errores a traducir

- **Prioridad insuficiente** (AC-1.2) → `409`, con el proyecto que ocupa la franja nombrado.
- **Empate de prioridad** (AC-1.3) → `409`, con el mensaje de que hay que resolverlo entre PMs. **No es el mismo error que el anterior** y no puede leerse igual: uno dice "no podés", el otro dice "hablalo".
- **`confirmedDisplacing` desajustado** → `409` con el conflicto actualizado.

---

## 5. La regla de prioridad, caso por caso

De la spec funcional §7.1, con lo que ya hace el código de `004`/`005` en cada caso:

| Reserva nueva | Reserva existente (`approved`) | Resultado                | Quién lo hace hoy                    |
| :------------ | :----------------------------- | :----------------------- | :----------------------------------- |
| Prioritaria   | Común                          | Desplaza                 | **Nuevo en `006`**                   |
| Común         | Prioritaria                    | Bloquea (AC-1.2)         | Ya bloquea: `findConflictingBooking` |
| Común         | Común                          | Bloquea                  | Ya bloquea                           |
| Prioritaria   | Prioritaria                    | Bloquea, manual (AC-1.3) | Ya bloquea, **falta el mensaje**     |

Dos cosas que conviene tener presentes:

**Solo se desplaza lo `approved`.** Dos reservas `pending` superpuestas conviven por diseño (AC-4.2 de `004`): el constraint no las mira. Así que una común todavía sin aprobar no hay que desplazarla — no ocupa nada.

**Y de ahí sale un agujero que ningún AC cubre — ver R-2.**

---

## 6. UI

### El conflicto gana un camino

Hoy el 409 del alta muestra `ConflictNotice` y ahí termina. Cuando el conflicto es **desplazable**, el mismo bloque suma la acción: `Desplazar y reservar`.

`DESIGN.md` §8: el conflicto que **impide** seguir usa `alert-triangle` sobre `--danger`. El desplazable no impide nada, así que **no puede verse igual**. Va como advertencia —`circle-alert` sobre `--attention`— y con el botón habilitado. Si las dos cosas se vieran iguales, el PM aprendería a ignorar las dos.

### El diálogo de confirmación

Desplazar es destructivo para otro equipo, así que pasa por confirmación, como cancelar en `004`. Tiene que decir, en palabras: **qué reserva se pisa, de qué proyecto y de qué PM**, y que la desplazada **no se restaura sola** si esta después se cae (AC-3.2). Esa última frase es la que evita el reclamo de la semana que viene.

### La desplazada en el calendario

Ya funciona desde `003`: `displaced` lleva `arrow-right-left` en `--attention` y **está en `DEFAULT_STATUSES`**, así que el PM la ve sin prender ningún filtro. Es justamente lo que `005` tuvo que arreglar para `rejected` (F7 de `005`) — acá ya estaba bien.

---

## 7. Integraciones externas

Ninguna. AC-2.1 (notificar al PM desplazado) y la notificación al dev son de `010`.

**Y esta vez pesa más que en `005`.** Ahí el que esperaba una respuesta era el dev, que entra a la app igual. Acá **a alguien le sacan una reserva ya confirmada sin pedirle permiso**, que es todo el punto de la feature. Sin notificación, el PM desplazado se entera mirando el calendario.

Lo que hay de consuelo: `displaced` es visible por default y el rastro queda en `audit_log`. No alcanza, y `tasks.md` lo arrastra como follow-up en vez de fingir que sí.

---

## 8. Dependencias entre features

- **`004`** — el `exclusion constraint`, `findConflictingBooking()` y el alta que se reusa.
- **`005`** — el trigger de transiciones, que hay que leer antes de tocar nada: la realocación escribe `status`, y ADR 0009 explica por qué eso pasa por un guard.
- **`010`** — las notificaciones. Ver §7.
- **`007`** — al desplazar una reserva aprobada hay que **borrar su evento** del Google Calendar del dev. Es de `007`, pero `006` le deja el rastro en `audit_log` del que colgarse.

### Lo que ADR 0009 le cobra a esta feature

El guard de columnas del trigger **no se dispara** al desplazar, y conviene saber por qué antes de asustarse:

- El bloque "aprobar es del dev asignado" mira `new.status in ('approved','rejected')`. `displaced` no está, así que no aplica.
- El guard de columnas solo corre cuando `auth.uid() = old.dev_id`, o sea cuando escribe el propio dev. Un PM nunca es el dev de la reserva (los roles son excluyentes), y un admin pasa por `can_manage_booking`.

**Pero si Q-6 se responde al revés** —que la realocación saltee también la aprobación del dev— la reserva nueva nacería `approved` escrita por el PM, y **eso sí choca de frente con el primer bloque del trigger**. Dejaría de ser una decisión de producto barata: habría que abrirle una excepción explícita al guard. Está anotado en el índice de features.

---

## 9. Riesgos y mitigaciones

**R-1 — Desplazar sin dejar rastro, o peor, sin desplazar.** El riesgo que la spec ya nombra. Se mitiga con la función atómica (§3.3) y con tests que **leen las filas de vuelta**, no que miran el código de error. Un `update` filtrado por RLS no falla: no hace nada.

**R-2 — La regla de prioridad solo se aplica al crear, no al aprobar. Ningún AC lo cubre.** Escenario: un PM común y uno prioritario reservan la misma franja del mismo dev; las dos quedan `pending` y conviven, porque el constraint no mira las pendientes. El dev entra a su bandeja y **aprueba primero la común**. Ahora la prioritaria no puede aprobarse: choca contra el constraint, y el proyecto prioritario perdió — sin que nadie haya desplazado nada. La prioridad no jugó en ningún momento. Tres salidas posibles: (a) ordenar la bandeja del dev por prioridad y advertirlo; (b) desplazar también al aprobar; (c) aceptarlo como límite del MVP.

**Resuelto el 2026-09-03: va (a).** Es casi gratis —el embed de `BOOKING_COLUMNS` ya trae `project.priority`— y saca el caso de "pasó sin que nadie lo viera", que era el peor de los tres. **No cierra el agujero**: el dev sigue pudiendo aprobar la común y dejar a la prioritaria sin franja; lo que cambia es que ahora es una decisión suya y no un accidente del orden de la lista. (b) queda anotada como deuda en `tasks.md` F4, porque mete la realocación en el camino de respuesta del dev —el que ADR 0009 tiene acotado— y porque abre una pregunta de producto sin contestar: si el dev, al aprobar, puede pisarle la reserva a un tercero. Lo implementa T2.5.

**R-3 — El PM desplazado no se entera.** Ver §7. Mitigación parcial: `displaced` visible por default y el rastro en `audit_log`.

**R-4 — Dos realocaciones prioritarias en paralelo sobre la misma franja.** Las dos leen "no hay otra prioritaria" y las dos escriben. La función corre en una sola transacción, pero eso no serializa por sí solo. Hay que decidirlo explícitamente —un `select … for update` sobre las reservas del dev en el rango— y probarlo **en paralelo**, no en serie, como se hizo en `005` T3.6.

**R-5 — El empate de prioridad no se resuelve solo** (Q-2). Con dos niveles, dos prioritarios en conflicto quedan en manos de los PMs. AC-1.3 lo acepta y define la conducta, así que **no bloquea la implementación**: bloquea la calidad de la solución.

---

## 10. Alternativas consideradas

- **Una policy más permisiva para el PM prioritario.** No se puede: la policy solo ve la fila que se toca y la regla depende de la reserva nueva, que todavía no existe. Descartada por la misma razón que ADR 0009.
- **Hacerlo en el handler con `service_role`.** Apagaría la RLS para todo el request, no solo para el desplazamiento. Prohibido por `CLAUDE.md`, y con razón.
- **Copiar `priority` a `bookings`.** Ahorraría el join, pero obligaría a sincronizarla en cada cambio de prioridad de un proyecto — exactamente lo que `004` decidió evitar. Y peor: una reserva quedaría con la prioridad congelada del día que se creó.
- **Un flag `displace: true` en `POST /api/bookings`.** Ver §4.

---

## 11. Testing strategy

Lo que `005` dejó como lección se aplica entero:

- **Unit** — la regla de §5 como función pura, la matriz de cuatro casos completa. Y el schema Zod con `confirmedDisplacing`.
- **Integración, lo que no puede faltar** — que el PM prioritario **sí** desplaza, que el común **no**, y **leyendo las filas de vuelta**: la común quedó `displaced` y la nueva `pending`. Un test que solo mire el error pasaría con la RLS filtrando en silencio, que es el modo de falla de §3.2.
- **Integración de atomicidad** — forzar el fallo del segundo paso y verificar que el primero tampoco quedó. Es lo único que prueba que la función es atómica de verdad.
- **Concurrencia (R-4)** — dos realocaciones en paralelo sobre la misma franja, en paralelo y no en serie.
- **Auditoría** — que la realocación deje las dos filas de §3.4.
- **E2E** — el PM prioritario ve el conflicto desplazable, confirma, y el PM desplazado ve su reserva en `displaced` sin tocar filtros.

**Y una fixture con su propia franja por test.** La lección de `005` T3.2: reusar el horario entre tests de una misma suite hace que la segunda aprobación muera contra el constraint, y el test falso pasa.

---

## 12. Rollout

Mismo orden que `005`, que ya demostró valer: **CI primero, proyecto remoto después.** La migration se aplica al proyecto de desarrollo recién con el PR en verde.

Un detalle propio de esta feature: **no habilitar la realocación con datos reales cargados hasta que R-1 esté cubierto por tests.** Una reserva perdida en silencio no se descubre hasta que alguien no aparece a trabajar.
