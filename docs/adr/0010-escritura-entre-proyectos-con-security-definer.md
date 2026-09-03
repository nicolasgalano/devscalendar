# 0010 — Una escritura que cruza proyectos se resuelve con una función `security definer`

- **Estado:** accepted
- **Fecha:** 2026-09-03

## Contexto

`006` necesita algo que hasta ahora ninguna feature había pedido: **que el PM de un proyecto escriba una reserva de otro proyecto, cuyo PM es otra persona.** Desplazar por prioridad es exactamente eso — la reserva que se marca `displaced` no le pertenece a quien la desplaza.

La RLS que venía funcionando dice lo contrario, y con razón:

```sql
create policy "bookings: manager update"
  on public.bookings for update to authenticated
  using (public.can_manage_booking(project_id))
  with check (public.can_manage_booking(project_id));
```

`can_manage_booking` es "admin, o el PM de ese proyecto". El PM prioritario no matchea el `using` de la reserva ajena, y ahí está lo peligroso, que es el motivo real de este ADR:

> **Un `update` que la RLS filtra no falla.** Afecta cero filas, sin error y sin excepción. Un handler que hiciera el `update` y después el `insert` respondería `201` con la reserva nueva creada y la vieja intacta en `approved`. El resultado serían **dos reservas aprobadas superpuestas** —lo único que la spec funcional §12 marca como no negociable— sin un solo mensaje en ningún lado.

No es un bug hipotético: es el comportamiento por defecto si la feature se implementa de la forma que parece natural. Es el R-1 de la spec de `006`.

Y no se arregla con una policy más ingeniosa. La regla que hace falta es *"podés escribir esta fila si estás creando otra de mayor prioridad que la pisa"*, y una policy solo ve la fila que se está tocando — no tiene forma de conocer la reserva nueva, que ni siquiera existe todavía. Es la misma clase de límite que ADR 0009 documentó para la autorización por columna: la RLS decide sobre filas, de a una.

## Decisión

**La operación entera vive en `reallocate_booking()`, una función `security definer` que crea la reserva nueva y desplaza las viejas en una sola transacción.** Cuatro partes:

**1. `security definer`, y no la `service_role` key desde el handler.** `CLAUDE.md` prohíbe esa key fuera de scripts puntuales, y con razón: desde un route handler apagaría la RLS para **todo** lo que ese request toque, no solo para el desplazamiento. La función definer la apaga adentro de su propio cuerpo y en ningún otro lado.

**2. La función impone sus propias reglas, en orden.** Apagar la RLS obliga a reemplazarla, no a prescindir de ella. Cinco chequeos antes de escribir nada: que quien llama administre el proyecto nuevo (`can_manage_booking`), que el dev exista y esté activo, qué reservas `approved` se superponen, que todas sean desplazables por la regla de prioridad, y recién ahí el `update` y el `insert`. El primero es el que evita que una función definer sea una puerta abierta a reservar en cualquier proyecto.

**3. `revoke all … from public` y `grant execute … to authenticated`.** `public` incluye a todos los roles: sin el revoke, `anon` también tendría execute.

**4. El cliente nombra lo que acepta pisar.** La función recibe `confirmed_displacing uuid[]` y **falla si lo que ocupa la franja en el momento de escribir no es exactamente eso**. Es la misma idea que el `expectedUpdatedAt` de `005`: entre que el PM ve el conflicto y confirma, el mundo puede cambiar, y desplazar algo que nunca vio es precisamente lo que esta feature no puede hacer. Chequearlo en el handler dejaría la ventana abierta; adentro de la transacción no hay ventana.

## Consecuencias

**Positivas:**

- La operación es **atómica**. Crear la nueva y desplazar la vieja pasan o fallan juntas: una reserva nueva encima de una aprobada, o una desplazada sin nada que la reemplace, son las dos peores que no haber hecho nada.
- **La RLS de `bookings` no se toca.** No hay policy nueva que ablande el caso general para habilitar uno particular, que era la otra salida y la que dejaba el agujero permanente.
- Cada rechazo sale con **su propio SQLSTATE** (`42501`, `DC001`–`DC004`), así que la API traduce por código y no por el texto del mensaje. Es lo que permite que el empate entre prioritarios y la prioridad insuficiente se lean distinto en la UI — uno dice "no podés", el otro "hablalo con el otro PM" — sin que esa diferencia dependa de un `if` sobre una cadena que alguien va a reescribir.

**Negativas:**

- **La regla de prioridad queda en dos lugares**, igual que en ADR 0008 y 0009 y con la misma justificación: `canDisplace()` en TypeScript para que la UI decida qué ofrecer antes de escribir, y la función para que la garantía no dependa de que un cliente se acuerde. La de la base es la que manda.
- **Una función definer es más fácil de romper que una policy.** Un `search_path` sin fijar o un chequeo movido de lugar cambia quién puede hacer qué, sin que nada lo señale. Por eso el `set search_path = public`, el orden de los chequeos escrito en el plan, y los tests de integración que **leen las filas de vuelta** en vez de mirar el código de error: un test que solo mire el error pasaría igual con la RLS filtrando en silencio, que es el modo de falla que este ADR existe para evitar.
- **Los SQLSTATEs `DC0xx` son inventados.** PostgREST no sabe qué status HTTP darles y puede contestar 500; el handler traduce por `error.code`, del cuerpo JSON, nunca por el status con que llegó la respuesta. Es una convención propia y hay que sostenerla.
- El bloqueo de concurrencia es **explícito y parcial**. Un `for update` sobre las reservas del dev en el rango serializa dos realocaciones simultáneas, pero no hay predicate lock sin `serializable`: una reserva aprobada *dentro* del rango después del lock no se ataja. La consecuencia está acotada —lo que se inserta es `pending`, así que no puede doble-bookear— y el exclusion constraint sigue siendo la garantía dura.

## Alcance futuro

Este patrón lo hereda **`007`**, que tiene el mismo problema con otra cara: borrar el evento de Google Calendar de una reserva ajena. Y cualquier feature que necesite escribir una fila cuyo dueño es otro. La pregunta que dispara este ADR no es "¿cómo le doy permiso a este usuario?", sino **"¿esta operación cruza proyectos de distinto dueño?"** — si la respuesta es sí, la policy no alcanza.

## Alternativas consideradas

- **Ablandar la policy de `update`** para que un PM prioritario pueda tocar reservas de proyectos comunes. Deja el permiso abierto **siempre**, no solo durante un desplazamiento confirmado: cualquier PM de un proyecto prioritario podría reescribir reservas ajenas por cualquier camino, incluido el cliente de Supabase desde el navegador.
- **`service_role` desde el route handler.** Más simple de escribir y peor en todo lo demás: apaga la RLS para el request entero, mueve la regla a un lugar que solo se cumple si se pasa por ese handler, y contradice `CLAUDE.md`.
- **Dos requests separados** (desplazar, después crear). Sin atomicidad: si el segundo falla, queda una reserva desplazada y nada en su lugar, y el PM desplazado perdió la franja para nadie.
