# Spec — Notifications & audit log

- **ID:** 010-notifications-and-audit
- **Estado:** ready-to-plan
- **Referencias en la spec funcional:** §7 (auditoría de realocación), §12 (auditoría no funcional), §6 y §8.3 (notificaciones)

---

## 1. Objetivo

Que **nadie se entere tarde de algo que le pasó a su tiempo**: avisar por bandeja
in-app y por email cuando una reserva lo involucra, y dejar en `audit_log` el
rastro completo de toda transición y acción sensible.

---

## 2. Contexto

Es el **último gate antes del primer usuario real**, y el motivo está en una sola
frase: hoy a alguien le desplazan una reserva confirmada y **solo se entera si
mira el calendario**. `005` salió sin avisos por decisión del 2026-08-12 y `006`
salió igual; las dos difirieron sus AC acá.

**Y de ahí sale la primera decisión de esta feature.** El default que la spec
arrastraba era "in-app siempre, email diferido a Fase 2". Una bandeja in-app
**no resuelve el problema que motiva la feature**: sigue habiendo que entrar a la
app para enterarse. Confirmado con el usuario el 2026-09-08 (Q-9): **van in-app
y email**. Slack sigue siendo de `009`.

Lo que ya existe y no se rehace: `audit_log` está desde `002` (ADR 0005), y `005`
y `006` ya escriben en él. Lo que falta de auditoría son dos acciones, no la
tabla.

---

## 3. User stories

- **US-1** — Como Dev, quiero **enterarme de que me reservaron tiempo** sin tener
  que entrar a mirar, para responder antes de que la fecha llegue.
- **US-2** — Como PM, quiero **enterarme de que aprobaron o rechazaron** mi
  reserva, para reaccionar sin vigilar el calendario.
- **US-3** — Como PM, quiero **enterarme de que me desplazaron una reserva
  confirmada**, que es el caso que hoy se descubre de casualidad y el que hace
  que esta feature sea gate.
- **US-4** — Como Dev o PM, quiero una **bandeja in-app** con lo que me pasó y
  poder marcarlo leído, para no perder de vista lo que todavía no atendí.
- **US-5** — Como Admin, quiero que **toda transición y acción sensible quede en
  `audit_log`** con actor, momento y diff, para poder reconstruir qué pasó.

---

## 4. Acceptance criteria

### US-1 a US-3 — que el aviso salga

- **AC-1.1** — Given una reserva nueva, when se persiste, then el **desarrollador
  asignado** recibe una notificación in-app y un email.
- **AC-1.2** — Given una reserva que el dev **aprueba o rechaza**, when se
  persiste, then el **PM del proyecto** recibe las dos. Si fue rechazo, el
  comentario obligatorio viaja en el aviso: un rechazo sin motivo obliga a entrar
  a buscarlo, que es justo lo que esto evita. _(Hereda AC-1.2 y AC-3.1 de `005`.)_
- **AC-1.3** — Given una reserva aprobada que el PM **mueve de horario o de
  desarrollador**, when vuelve a `pending` (Q-E), then el dev recibe aviso de que
  lo que había aprobado cambió.
- **AC-1.4** — Given una reserva **cancelada** por el PM, when se persiste, then
  el desarrollador se entera.
- **AC-1.5** — Given una reserva **desplazada** por prioridad, when la
  realocación ocurre, then **el PM del proyecto desplazado y el desarrollador**
  reciben aviso, nombrando qué proyecto se la llevó. _(Hereda AC-2.1 de `006`.)_
- **AC-1.6** — **Nadie recibe aviso de su propia acción.** Con roles múltiples
  (`012`) un PM puede ser el desarrollador de su propia reserva; avisarle de lo
  que acaba de hacer es ruido que enseña a ignorar la bandeja.
- **AC-1.7** — Given un destinatario **desactivado**, when se genera el evento,
  then la notificación se registra pero **no se manda el email**. Dar de baja a
  alguien deja de escribirle.

### US-4 — la bandeja

- **AC-4.1** — Given notificaciones sin leer, when el usuario carga cualquier
  pantalla, then ve un **indicador con la cantidad** en la navegación.
- **AC-4.2** — Given la bandeja abierta, when el usuario clickea una
  notificación, then queda **marcada como leída** y lo lleva a la reserva.
- **AC-4.3** — Given una notificación ya leída, when se vuelve a mirar, then
  sigue estando: se marcan, no se borran.
- **AC-4.4** — **Desvío registrado de la versión anterior de este AC:** la
  bandeja **no usa Realtime**. Se actualiza al navegar y al volver a la pestaña.
  Decidido con el usuario el 2026-09-08: el stack efímero de CI excluye Realtime
  a propósito para no comerse la RAM del runner, y un aviso que se lee cada
  varias horas no justifica ni esa infraestructura ni dejar la única parte del
  producto sin cobertura. Si algún día importa, se suma sin tocar el modelo.
- **AC-4.5** — Cada notificación registra **sus canales y el estado de entrega
  por canal**, para poder responder "¿le llegó el mail?" sin adivinar.

### US-5 — auditoría

- **AC-5.1** — Given cualquier transición de reserva —**crear, editar**,
  aprobar, rechazar, cancelar, desplazar—, when ocurre, then hay una fila en
  `audit_log` con actor, acción, referencia, momento y diff.
  - **Hoy faltan `create` y `update`**: `005` registra el cambio de estado y
    `006` la realocación, pero una reserva creada, o movida sin cambiar de
    estado, no deja rastro.
- **AC-5.2** — Given una realocación, when ocurre, then hay **dos** filas: el
  desplazamiento de la vieja y la creación de la nueva. _(Ya se cumple desde
  `006`; queda como criterio para no romperlo.)_
- **AC-5.3** — `audit_log` es **append-only** para todo el mundo salvo
  `service_role`. _(Ya se cumple desde `002`.)_
- **AC-5.4** — Given un Admin, when quiere investigar, then puede consultar por
  reserva, actor y rango. **En el MVP es consulta SQL**, no pantalla.

---

## 5. Alcance

### Dentro

- Tabla `notifications` con destinatario, tipo, referencia y estado de entrega
  por canal.
- Las filas las escriben **triggers de la base**, no el código de la app.
- Bandeja in-app en el shell, con contador y marcar-como-leído.
- Envío de **email** por un proveedor transaccional, con reintento.
- `audit_log` gana `create` y `update` de reservas.

### Fuera (explícito)

- **Slack** — es `009`, y consume esta misma infraestructura como un canal más.
- **Realtime** (AC-4.4).
- **Preferencias por usuario** de qué avisar por dónde. Defaults sensatos y
  listo; si hace falta, es una tabla más sin tocar lo demás.
- **UI de administración del `audit_log`** — Fase 2, como ya decía la spec.
- **Retención del `audit_log`** — Q-M se responde con su default el 2026-09-08:
  **indefinida**. Se evalúa archivar a los 12–24 meses, cuando haya volumen.
- **Digest / resumen diario.** Un aviso por evento; si resulta ruidoso, se
  agrupa después con los datos a la vista.

---

## 6. Dependencias

- **004, 005, 006** — son las que generan los eventos. Todas cerradas.
- **012** — imprescindible y ya está: las notificaciones salen hacia
  `projects.pm_id`, y hasta que los roles fueron un conjunto ese campo podía
  nombrar a alguien que no llevaba el proyecto. Era el prerequisito de esta
  feature.
- **Externa: una cuenta en un proveedor de email transaccional** y un dominio
  verificado para el remitente. Sin eso el canal de email queda inerte — la
  bandeja in-app funciona igual.

---

## 7. Preguntas abiertas

- ~~**Q-9**~~ — ~~¿Canales?~~ **Respondida el 2026-09-08: in-app + email.**
  Slack queda en `009`.
- ~~**Q-M**~~ — ~~¿Retención del `audit_log`?~~ **Respondida el 2026-09-08 con su
  default: indefinida en el MVP.**
- **Q-R1** — ¿El email lleva el detalle de la reserva o solo "entrá a ver"?
  **Default aplicado:** lleva proyecto, fecha, horario y —si es rechazo— el
  comentario. Un aviso que obliga a entrar para saber qué pasó es medio aviso.
  **Ojo:** eso pone datos del equipo en la bandeja de correo de cada uno; si
  algún día hay clientes externos con acceso, se revisa.

---

## 8. Métricas de éxito

- **Cero eventos de los seis de US-1..US-3 sin su fila** en `notifications`.
- 100% de transiciones críticas con fila en `audit_log`.
- Ningún email a una cuenta desactivada.

---

## 9. Riesgos conocidos

- **R-1 — El aviso se pierde si el envío es parte de la escritura.** Si el email
  se manda dentro del request que crea la reserva, una caída del proveedor puede
  volver lenta o fallida una operación que no tiene nada que ver.
  **Mitigación:** la fila de `notifications` es la unidad durable y se escribe en
  la misma transacción que el evento; el envío es un paso aparte, reintentable, y
  su fracaso no toca la reserva.
- **R-2 — Notificar de más enseña a ignorar.** Seis tipos de evento por cada
  reserva, multiplicados por un equipo chico, se vuelven ruido rápido.
  **Mitigación:** AC-1.6 saca los avisos de la propia acción, que en un equipo
  donde alguien es PM y dev a la vez son una porción real.
- **R-3 — El email es un canal que se va del producto.** Una vez enviado no se
  puede corregir ni retirar, y va a la bandeja personal de cada uno.
  **Mitigación:** el contenido es el mínimo útil (Q-R1), nunca datos que no estén
  ya en la app, y un destinatario desactivado deja de recibir (AC-1.7).
- **R-4 — Depender de un tercero nuevo.** Si el proveedor cambia precios, falla o
  bloquea la cuenta, el canal muere. **Mitigación:** el envío está detrás de una
  interfaz chica; cambiar de proveedor es reescribir esa función, no la feature.
