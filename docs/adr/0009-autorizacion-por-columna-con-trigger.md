# 0009 — La autorización por columna se resuelve con trigger, no con RLS

- **Estado:** accepted
- **Fecha:** 2026-08-26

## Contexto

`005` necesitaba una regla que suena trivial: **el desarrollador puede escribir su propia reserva, pero solo `status` y `response_note`.** No puede moverse el horario, ni reasignarse a otro dev, ni reescribir el pedido del PM.

La RLS de Postgres **no sabe expresar eso**. Sus dos cláusulas miran filas enteras:

- `using` decide qué filas se pueden tocar, mirando la fila **vieja**.
- `with check` valida el resultado, mirando la fila **nueva**.

Ninguna de las dos compara la nueva contra la vieja, que es exactamente lo que hace falta para decir "esta columna no cambió". Postgres tiene `grant update (columna)` a nivel de tabla, pero es por rol de base de datos, y acá todos los usuarios de la app entran como `authenticated`: un grant por columna se lo aplicaría también al PM, que sí tiene que poder mover el horario.

Así que la policy del dev quedó necesariamente amplia:

```sql
create policy "bookings: developer responds"
  on public.bookings for update to authenticated
  using (dev_id = auth.uid())
  with check (dev_id = auth.uid());
```

Eso, solo, significa **"el desarrollador puede reescribir cualquier columna de sus propias reservas"** — incluidas sus propias horas. Que no sea eso depende enteramente de lo que se le ponga encima.

La decisión es transversal y por eso hay ADR: `006` escribe `status` al desplazar por prioridad y va a chocar con la misma función, y `010` va a leer el rastro que deja. Quien escriba en `bookings` tiene que saber dónde vive la regla.

## Decisión

**La autorización por columna vive en un guard dentro de `enforce_booking_status_transition()`, el trigger `before update` que `004` ya había instalado.** Tres partes:

**1. Un solo trigger, no dos.** El guard extiende la función existente en vez de agregar un trigger nuevo. Dos triggers `before update` sobre la misma tabla se ejecutan **por orden alfabético de sus nombres**, y hacer depender una regla de seguridad de ese orden es pedirla prestada al azar.

**2. Lista de lo escribible, no de lo prohibido.**

```sql
responder_writable constant text[] := array['status', 'response_note', 'updated_at'];
...
if (to_jsonb(new) - responder_writable) is distinct from (to_jsonb(old) - responder_writable) then
  raise exception '...' using errcode = 'check_violation';
end if;
```

Una columna que agregue una feature futura **nace protegida**. Abrirla exige nombrarla acá, que es un acto de revisión; con una lista de prohibidas, olvidarse es un acto de distracción y el resultado es una columna escribible que nadie decidió.

**3. La policy y el guard viajan en la misma migration.** Aplicar la policy sin el guard abre una ventana —de minutos o de días, según cuándo se corra la segunda— en la que cualquier desarrollador puede reescribirse las horas.

## Consecuencias

**Positivas:**

- La regla se cumple **por cualquier camino de escritura**: la API, un script, `psql`, o una feature que todavía no existe. No depende de que un handler se acuerde.
- El error sale con `errcode = 'check_violation'` (`23514`), que la API traduce a un 403 con el mensaje del trigger, ya en castellano. No es un 500.
- `service_role` queda exento porque `auth.uid()` es null: seeds y fixtures siembran estados directamente, y son confiables por definición.
- El admin **no** queda exento, y es el único lugar de la app donde el rol admin no alcanza. El guard pregunta `not can_manage_booking(...)`, así que a un admin que administra la reserva no lo toca; pero el bloque de más arriba —"aprobar es del dev asignado"— compara `auth.uid()` contra `dev_id` **sin mirar el rol**, y ese sí lo frena. Aprobar no es una operación administrativa: es un compromiso sobre el tiempo de una persona.

**Negativas:**

- **La regla queda escrita en cuatro lugares**, y hay que decirlo en voz alta: el trigger la impone, `requireBookingResponder()` la traduce a un 403 legible, `canRespondToBooking()` decide si se dibuja el botón, y `nextStatusAfterResponse()` la modela para los tests unitarios. Es la misma tensión que ADR 0008 ya aceptó para el anti doble-booking, con la misma justificación: la de la base es la que manda, las otras existen para que el usuario se entere temprano y en palabras.
- **`to_jsonb(new) - array[...]` compara la fila entera**, así que es sensible a cualquier columna nueva. Es la propiedad que se buscaba, pero significa que una migration que agregue una columna a `bookings` **rompe la respuesta del desarrollador** si esa columna se escribe en el mismo `update`. El síntoma es un `23514` inesperado.
- Una regla de autorización en PL/pgSQL es menos evidente que una policy: quien lea solo las policies de `bookings` va a concluir que el dev puede escribir cualquier columna, y va a estar equivocado. Por eso el comentario de la migration lo dice explícito y este ADR existe.

## Alternativas consideradas

- **Una segunda policy más restrictiva.** No sirve: las policies del mismo comando se combinan con **OR**, así que una policy adicional solo puede **agregar** permisos, nunca acotar los de otra.
- **Columnas generadas o una vista actualizable.** Habría que reconstruir el camino de escritura entero alrededor de una vista, y la RLS quedaría partida entre la tabla y la vista. Mucho más aparato para la misma garantía.
- **Solo el guard de la API.** Es lo que hace la mayoría de las apps, y es exactamente lo que la RLS de este proyecto viene a no hacer: un `update` desde el cliente de Supabase —que la app usa en todos lados— se saltearía el handler por completo.
