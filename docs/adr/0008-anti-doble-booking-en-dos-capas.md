# 0008 — El anti doble-booking vive en dos capas, no en una

- **Estado:** accepted
- **Fecha:** 2026-08-12

## Contexto

La spec funcional §12 marca el anti doble-booking como el único requisito no negociable, y `004/plan.md` §3.1 lo resolvió con un `exclusion constraint`:

```sql
exclude using gist (dev_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'approved')
```

Ese `where` es deliberado y responde a AC-4.2: dos reservas **pendientes** superpuestas conviven, porque dos PMs tienen que poder proponerle el mismo horario al mismo desarrollador y que él decida.

El plan asumió que ese constraint también cubría AC-1.2 —"no se puede proponer una franja donde el desarrollador ya tiene un compromiso confirmado"—. **No puede, y el motivo es el mismo `where`:** toda reserva nace `pending`, así que en un alta el constraint nunca se dispara. Se descubrió probando la API contra el servidor real: crear una reserva encima de una aprobada devolvía `201`.

La decisión afecta a más de una feature —`005` escribe el cambio de estado, `006` reasigna por prioridad y `F3` mueve bloques con drag & drop—, así que amerita ADR: quien escriba en `bookings` tiene que saber cuál de las dos capas lo protege.

## Decisión

**El anti doble-booking se garantiza en dos capas con responsabilidades distintas, y ninguna de las dos reemplaza a la otra.**

1. **El `exclusion constraint` es la garantía dura.** Hace imposible que dos reservas aprobadas del mismo desarrollador se superpongan, sin importar por qué camino se escriba: API, script, `psql` o una feature futura que todavía no existe. No se puede olvidar.
2. **El chequeo aplicativo es la garantía de trato.** Antes de insertar (y antes de mover el horario o el desarrollador en un `PATCH`), el handler busca la reserva aprobada que se superpone y responde `409` **con esa reserva en el cuerpo**. Vive en `src/lib/bookings/conflicts.ts`.

## Consecuencias

**Positivas:**

- El PM se entera al proponer, no cuando el desarrollador intenta aprobar días después. Y se entera de *cuál* reserva bloquea: Postgres informa que hay conflicto, nunca qué fila lo causó, así que buscarla es trabajo del handler.
- AC-4.2 sigue intacto: dos `pending` superpuestas conviven, porque el chequeo solo mira contra `approved`.
- La corrección no depende de que nadie se olvide del chequeo. Si una feature futura escribe sin él, lo peor que produce es una `pending` superpuesta —exactamente lo que el modelo permite—, y el constraint la frena al aprobar.

**Negativas:**

- **Hay una ventana de carrera en la capa aplicativa**, y hay que nombrarla en vez de fingir que no existe: entre el `select` y el `insert`, otro request puede aprobar una reserva. Es una ventana acotada a propósito: su peor consecuencia es una `pending` superpuesta a una `approved`, que es un estado válido del modelo, no una corrupción.
- La regla del solapamiento queda escrita dos veces —en SQL y en TypeScript— y las dos tienen que decir lo mismo, incluido el borde `[)` (09:00–13:00 y 13:00–17:00 **no** son conflicto). `findConflictingBooking()` replica la condición del constraint (`starts_at < ends and ends_at > starts`) y hay tests de integración que verifican el borde en las dos.
- **`005` hereda una obligación:** al aprobar, el `update` va a chocar contra el constraint y devolver `23P01`. Ese error hay que traducirlo a un mensaje que le sirva al desarrollador —"esta franja ya te la aprobaron para otro proyecto"—, no dejarlo salir como 500.

## Alternativas consideradas

- **Excluir también las `pending`.** Una sola capa y mucho más simple de explicar. Rompe AC-4.2 y el flujo real del producto: dos PMs no podrían proponer el mismo horario, y el primero en escribir se quedaría con el desarrollador sin que nadie decidiera nada.
- **Solo el constraint, sin chequeo aplicativo.** Es lo que decía el plan. Deja AC-1.2 sin cumplir: el alta pasa siempre y el conflicto aparece recién en la aprobación, después de que el PM ya organizó su semana sobre una reserva que no va a existir.
- **Solo el chequeo aplicativo, sin constraint.** Lo que la spec funcional §12 descarta explícitamente, y con razón: entre leer y escribir hay una ventana en la que otro request escribe. El test de concurrencia de `004` (cuatro inserts en paralelo sobre franjas superpuestas) lo demuestra — exactamente uno persiste, y son las tres violaciones `23P01` las que lo garantizan.
- **Transacción `serializable` en vez de constraint.** Resolvería la carrera, pero mueve la garantía a que *todos* los caminos de escritura recuerden usar el nivel de aislamiento correcto. El constraint no se puede olvidar; una convención sí.
