# ADR 0012 — Las notificaciones son un outbox escrito por trigger

- **Fecha:** 2026-09-08
- **Estado:** aceptada
- **Feature:** `010-notifications-and-audit`

---

## Contexto

`010` es el último gate antes del primer usuario real, y el motivo cabe en una
frase: hoy a alguien le desplazan una reserva confirmada y **solo se entera si
mira el calendario**. `005` y `006` salieron sin avisos por decisión, y las dos
difirieron sus AC acá.

Un aviso tiene dos mitades con exigencias opuestas:

- **Que exista** es tan importante como la reserva misma. Si se creó una reserva
  y el aviso se perdió, el sistema mintió por omisión.
- **Que salga** depende de un tercero —un proveedor de email— que puede estar
  caído, lento, o sin configurar.

Meter las dos del mismo lado obliga a elegir entre perder avisos o hacer que
crear una reserva dependa de que el proveedor de email esté vivo.

## Decisión

**Las dos mitades van separadas por una línea, y la línea es la transacción.**

1. **La fila de `notifications` la escribe un trigger de la base, en la misma
   transacción que el evento.** Si la reserva existe, el aviso existe. No hay
   camino de escritura que pueda saltearlo, porque no depende de que ningún
   handler se acuerde de llamarlo.
2. **El envío está del otro lado**, en un endpoint que drena la cola y puede
   fallar todas las veces que quiera. Nadie pierde una reserva ni un aviso: la
   entrega se retrasa.

El drenaje corre por dos caminos: **inline y sin esperar** apenas termina la
escritura —el camino del 99%, que hace que el mail salga en segundos— y **por
cron** como red de seguridad para lo que quedó pendiente.

## Por qué un trigger y no el código de la app

Es la misma lección que ADR 0010, aplicada a otra cosa: **la regla tiene que
estar donde no se pueda esquivar.** Si el aviso lo escribiera el handler, cada
camino de escritura nuevo tendría que acordarse de generarlo, y olvidarse no
falla — deja de avisar, en silencio, que es el peor modo de falla posible para
esta feature en particular.

Hay una excepción, y está explicada donde vive: **`booking_displaced` lo escribe
`reallocate_booking()`, no el trigger.** Esa función marca la reserva vieja como
desplazada *antes* de insertar la nueva, así que cuando el trigger corre, el
proyecto que se llevó la franja todavía no existe — y el AC pide justamente
nombrarlo. La función tiene las dos reservas en la mano; el trigger no.

## Por qué el `payload` se congela

La fila guarda el nombre del proyecto, la franja y el motivo del rechazo en vez
de leerlos al renderizar. Un aviso tiene que poder decir "te sacaron el martes en
Proyecto X" **aunque la reserva haya cambiado tres veces desde entonces**. Un
aviso que refleja el estado actual en vez del que motivó el aviso no es un aviso:
es una consulta.

Lo que **no** se congela es el texto. El trigger guarda los hechos y las oraciones
las arma la app (`src/lib/notifications/events.ts`), así que cambiar el copy no
necesita una migration ni deja los avisos viejos hablando distinto que los nuevos.

## Consecuencias

- **El trigger corre adentro de la escritura de la reserva.** Si tira, no falla el
  aviso: falla la reserva. Por eso hace una sola cosa —resolver destinatario e
  insertar— y ninguna que pueda fallar por datos.
- **Reclamar la fila es parte del envío.** El `update` a `sending` es el que la
  toma, así que el drenaje inline y el cron no pueden mandar el mismo aviso dos
  veces. Eso obligó a una migration extra el mismo día (`…0012`), porque el
  `check` original no contemplaba ese estado.
- **Sin proveedor configurado no se rompe nada.** Las filas se quedan `pending` y
  la bandeja in-app funciona igual. Es también lo que permite que CI corra la
  suite entera sin credenciales de ningún tercero.
- **"Desactivado" no es "falló".** Un destinatario dado de baja deja la fila en
  `skipped`, no en `failed`, porque un reintento sobre un `failed` volvería a
  escribirle a alguien que ya no está.
- **La bandeja no es `/inbox`.** La campana es "qué pasó" y solo lleva; `/inbox`
  es "qué tengo que responder" y tiene acciones. Que se parecieran sería la forma
  más rápida de que el equipo deje de mirar las dos.

## Alternativas descartadas

- **Mandar el mail dentro del handler.** Más simple de escribir y peor en todo lo
  demás: le agrega la latencia del proveedor a la creación de una reserva, y una
  caída del proveedor puede hacer fallar una operación que no tiene nada que ver
  con el email.
- **Escribir la notificación desde el código de la app.** Deja la regla en un
  lugar que solo se cumple si se pasa por ahí. `reallocate_booking()` ya había
  enseñado esa lección con la RLS.
- **Realtime para la bandeja**, como pedía el AC original. Se descartó el
  2026-09-08: el stack efímero de CI excluye Realtime a propósito para no comerse
  la RAM del runner, y un aviso que se lee cada varias horas no justifica ni esa
  infraestructura ni dejar la única parte del producto sin cobertura. Se refresca
  al navegar y al volver a la pestaña.
- **Una cola de verdad** (pgmq, un worker). Correcta y desproporcionada para el
  volumen: la tabla ya es una cola durable con un índice parcial, y el día que no
  alcance, cambiar el drenaje no toca ni el trigger ni la UI.
