# Plan — Notifications & audit log

- **ID:** 010-notifications-and-audit
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Una tabla `notifications` que funciona como **outbox**: las filas las escriben
triggers de la base en la misma transacción que el evento, así que un aviso no se
puede perder por un error de la app ni saltear escribiendo por otro camino. La
bandeja in-app lee esas filas; el email las **drena** en un paso aparte que puede
fallar y reintentar sin tocar la reserva.

`audit_log` no se rehace: se le suman las dos acciones que faltaban.

---

## 2. Arquitectura

```
  POST /api/bookings ──┐
  PATCH  …/[id]      ──┼──► bookings (write)
  reallocate_booking ──┘        │
                                │ trigger (same transaction)
                                ▼
                        notifications  ◄── durable outbox
                         │           │
              lee la     │           │  drena
              bandeja    │           ▼
                         │    POST /api/notifications/dispatch
                         ▼           │
                    NotificationBell  └──► proveedor de email
```

**Lo que hace fuerte al diseño es dónde está la línea de durabilidad.** La fila
se escribe con el evento, atómicamente: si la reserva existe, el aviso existe. El
envío está del otro lado de esa línea y puede fallar todas las veces que quiera
sin que nadie pierda una reserva ni un aviso — solo se retrasa.

### El drenaje, en dos tiempos

1. **Inline y best-effort:** apenas el handler termina de escribir, dispara el
   dispatch **sin esperarlo**. Es el camino del 99% y hace que el mail salga en
   segundos.
2. **Cron como red:** un cron de Vercel llama al mismo endpoint cada tanto y
   levanta lo que quedó `pending` — porque el proceso murió, porque el proveedor
   estaba caído, o porque la escritura vino de un camino que no disparó nada.

> **Ojo con el plan de Vercel:** en Hobby los cron jobs corren **una vez por
> día**; la cadencia por minuto es de Pro. Con el drenaje inline andando eso es
> aceptable —la red de seguridad tarda más en levantar un fallo— pero conviene
> saberlo antes de prometer tiempos. Si el plan es Hobby y el retraso molesta, la
> salida barata es reintentar también al abrir la bandeja.

---

## 3. Modelo de datos

Una migration, `00000000000011_notifications.sql`.

### 3.1 `notifications`

```sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,               -- booking_created | booking_approved | …
  booking_id uuid references public.bookings(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  email_status text not null default 'pending'
    check (email_status in ('pending','sent','failed','skipped')),
  email_attempts int not null default 0,
  email_error text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
```

- **`on delete cascade` en las dos FK, y es un desvío de la convención del
  proyecto** (`CLAUDE.md` §Migrations: blanda → `set null`, dura → `restrict`).
  El motivo: una notificación no es historia, es un mensaje. Sin su destinatario
  no significa nada, y sin su reserva no tiene a dónde llevar. La historia la
  guarda `audit_log`, que sí sobrevive a la baja del actor — por eso ahí la
  convención es `set null` y acá no.
- **`payload` congela lo que hay que mostrar** —nombre del proyecto, franja, el
  comentario del rechazo— en vez de leerlo al renderizar. Un aviso tiene que
  poder decir "te desplazaron la reserva del martes en Proyecto X" incluso
  después de que la reserva cambie otra vez.
- `email_status = 'skipped'` es AC-1.7: destinatario desactivado. No es un
  fallo, es una decisión, y mezclarlo con `failed` haría que un reintento le
  escriba a alguien dado de baja.

### 3.2 RLS

| Operación | Quién                | Cómo                                            |
| :-------- | :------------------- | :---------------------------------------------- |
| `select`  | solo el destinatario | `recipient_id = auth.uid()`                     |
| `insert`  | nadie                | sin grant; solo los triggers `security definer` |
| `update`  | nadie por policy     | marcar leído va por función (§3.4)              |
| todo      | `service_role`       | para el dispatch y las fixtures                 |

**El `select` no pasa por `has_role()`**: alguien desactivado tiene que poder
seguir leyendo lo que ya le llegó. Es el mismo criterio que `profiles: self read`
en `012` — el chequeo de `active` corta lo que podés _hacer_, no lo que te
pasó.

### 3.3 Los triggers que generan avisos

Uno solo `after insert or update on bookings`, `security definer`, que decide
tipo y destinatario:

| Evento               | Tipo                       | Destinatario                       |
| :------------------- | :------------------------- | :--------------------------------- |
| insert               | `booking_created`          | `new.dev_id`                       |
| `→ approved`         | `booking_approved`         | PM del proyecto                    |
| `→ rejected`         | `booking_rejected`         | PM del proyecto                    |
| `→ cancelled`        | `booking_cancelled`        | `new.dev_id`                       |
| `approved → pending` | `booking_needs_reapproval` | `new.dev_id`                       |
| `→ displaced`        | `booking_displaced`        | PM del proyecto **y** `new.dev_id` |

**AC-1.6 se aplica en un solo lugar:** antes de insertar, si
`recipient_id = auth.uid()` no se escribe la fila. Con `service_role` —seeds y
fixtures— `auth.uid()` es null y no filtra nada, que es lo que esos casos
necesitan.

**`booking_displaced` genera dos filas**, una por destinatario. Es el caso que
justifica la feature entera y el único con más de un interesado.

### 3.4 Marcar leído

Una función `security definer`, `mark_notifications_read(ids uuid[])`, que sólo
toca `read_at` y sólo sobre filas del llamador.

**Por qué una función y no una policy de `update`:** es exactamente el problema
de ADR 0009 —la RLS no sabe decir "sólo esta columna", porque `using` mira la
fila vieja y `with check` la nueva y ninguna las compara— y ahí se resolvió con
un guard adentro de un trigger. Acá alcanza con no dar el grant: no hay regla de
negocio sobre `read_at` más allá de "es mío", así que una función chica es menos
maquinaria que una policy más un trigger que la corrija.

### 3.5 `audit_log`: las dos acciones que faltaban

`create` y `update` de reservas, en el mismo trigger que ya existe. Sin cambios
de esquema: la tabla ya acepta cualquier `action`.

---

## 4. API

| Método | Ruta                          | Qué hace                 | Auth                           |
| :----- | :---------------------------- | :----------------------- | :----------------------------- |
| POST   | `/api/notifications/dispatch` | Drena pendientes y manda | **secreto de cron**, no sesión |
| POST   | `/api/notifications/read`     | Marca leídas por id      | sesión (la función filtra)     |

**El dispatch no se autentica con sesión** porque lo llama un cron. Va con un
secreto en header (`CRON_SECRET`), comparado en tiempo constante, y **nunca
devuelve contenido de las notificaciones** — solo cuántas mandó y cuántas
fallaron. Un endpoint que drena mensajes ajenos no puede ser también una forma de
leerlos.

### El envío

Detrás de una interfaz de una función (R-4 de la spec):

```ts
sendEmail({ to, subject, body }): Promise<{ ok: true } | { ok: false; error: string }>
```

**Proveedor propuesto: Resend** — es el que mejor encaja con Next.js en Vercel,
tiene tier gratuito suficiente para este volumen y una API HTTP sin SDK
obligatorio. **No lo instalo sin tu OK**: implica una cuenta, un dominio
verificado como remitente y una variable nueva (`RESEND_API_KEY`) en Vercel y en
`.env.example`.

**Sin la key configurada la feature no se rompe:** `sendEmail()` devuelve
`{ok:false}`, las filas quedan `pending`, y la bandeja in-app anda igual. Eso
también es lo que hace que CI no necesite credenciales de nadie.

---

## 5. UI

- **`NotificationBell`** en el header del shell: campana, badge con la cantidad
  sin leer, y un popover con las últimas N. Cada ítem lleva a su reserva y se
  marca leído al clickear (AC-4.2).
- **Sin Realtime** (AC-4.4): el contador se recalcula en cada render del shell
  —que es server-side y ya corre por navegación— más un refresco al volver a la
  pestaña (`visibilitychange`). Simple y suficiente.
- **No se confunde con `/inbox`**, que es la bandeja de _reservas pendientes_ del
  dev y sigue siendo otra cosa. La campana es "qué pasó"; `/inbox` es "qué tengo
  que responder". Vale nombrarlo en la UI para que no parezcan lo mismo.
- El copy sale de `DESIGN.md` §11 y se lee la checklist antes de dar la vista por
  terminada.

---

## 6. Testing strategy

- **Unit** — la función que decide tipo y destinatario por evento, incluida
  AC-1.6 (no avisarse a uno mismo) y el caso de `012`: alguien que es PM y dev de
  la misma reserva. Y el formateo del email, que es una función pura.
- **Integración** — por cada uno de los seis eventos, **leyendo las filas de
  vuelta**: que exista la notificación, que el destinatario sea el correcto, que
  el desplazamiento genere dos, que la propia acción no genere ninguna, y que un
  destinatario desactivado quede `skipped`. Más la RLS: que nadie lea las de otro
  y que nadie pueda insertar a mano.
- **Smoke** — el `select` de la bandeja con su embed de reserva y proyecto.
- **E2E** — el flujo que justifica la feature: un PM prioritario desplaza una
  reserva confirmada de otro PM, y **ese otro PM ve la campana con un aviso** que
  nombra el proyecto que se la llevó.
- **Manual** — que el email llegue de verdad y se lea bien en un cliente de
  correo. Ningún test cubre eso.

---

## 7. Riesgos y mitigaciones

- **R-1 — El trigger corre dentro de la escritura de la reserva.** Si tiene un
  error, no falla el aviso: **falla la reserva**. **Mitigación:** el trigger no
  hace nada que pueda fallar por datos —resuelve destinatario con un `select` y
  escribe— y los tests de integración de `004`/`005`/`006` siguen corriendo, así
  que romper una escritura se ve enseguida.
- **R-2 — Bucle de notificaciones.** Un trigger `after update` que escribiera en
  `bookings` se volvería a disparar. **Mitigación:** este trigger sólo escribe en
  `notifications` y `audit_log`; ninguna de las dos tiene triggers que vuelvan a
  `bookings`.
- **R-3 — El dispatch se pisa consigo mismo** y manda dos veces si el inline y el
  cron corren juntos. **Mitigación:** el `update` que marca `sent` es el que
  reclama la fila (`where email_status = 'pending'` con `returning`), así que dos
  corridas simultáneas no se llevan la misma.
- **R-4 — La migration corre sobre una base con datos reales.** Desde el
  2026-09-08 esto ya no es hipotético. **Mitigación:** es puramente aditiva
  —tabla nueva, funciones nuevas, un trigger nuevo— así que **cumple la regla de
  las dos fases sin esfuerzo**: no hay nada que borrar y el código viejo sigue
  andando sin enterarse.

---

## 8. Rollout

1. Migration (aditiva) → `db:push` → `db:types`.
2. Código + tests → CI verde → push a `main`.
3. **Recién después**, configurar el proveedor de email y su variable en Vercel.
   Hasta que eso pase, las filas se acumulan en `pending` y la bandeja in-app
   funciona: el orden es a propósito, para que el canal nuevo no sea condición
   para que salga el resto.
