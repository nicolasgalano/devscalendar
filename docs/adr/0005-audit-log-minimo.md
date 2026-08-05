# 0005 — `audit_log` mínimo en 002, extensible por 010

- **Estado:** accepted
- **Fecha:** 2026-08-04

## Contexto

El AC-2.2 de `002-entities-admin` pide que el cambio de prioridad de un proyecto quede registrado en `audit_log`. Pero esa tabla es dueña de `010-notifications-and-audit`, que todavía no existe y que además depende de `004`, `005` y `006` — features que llegan mucho después.

Las salidas eran: postergar el AC hasta que exista `010` (dejando `002` incompleta), o crear la tabla ahora asumiendo el riesgo de que `010` la quiera distinta.

## Decisión

Se crea en `002` una versión mínima de `audit_log` con la forma genérica que `010` va a necesitar igual —`entity`, `entity_id`, `action`, `actor_id`, `diff jsonb`, `created_at`— pero usada por un solo caso: el trigger `projects_log_priority_change`.

La tabla es **append-only por diseño**: nadie tiene grant de `insert` ni `update`. La única forma de escribir una fila es el trigger, que es `security definer`. `service_role` puede leer y borrar (retención), `authenticated` solo lee y solo si es admin.

`010` extiende esta tabla agregando valores de `entity`/`action` y triggers nuevos, sin migrar datos existentes.

## Consecuencias

**Positivas:**

- `002` cumple su AC sin quedar bloqueada por una feature que llega ocho features después.
- El esquema genérico (`entity` + `action` + `diff`) no compromete a `010` a un modelo puntual: cualquier entidad futura entra sin `alter table`.
- Que nadie pueda insertar salvo el trigger hace que el registro no se pueda falsificar, ni siquiera desde código server-side con la service key. Para un log de auditoría eso es la propiedad que importa.

**Negativas / a mitigar:**

- `010` puede querer una forma distinta (por ejemplo, columnas dedicadas en vez de `diff jsonb`). Mitigación: `diff` como `jsonb` es lo bastante laxo para absorber casi cualquier cambio; y mientras solo haya filas de `priority_changed`, migrarlas es trivial.
- No hay pantalla que muestre la auditoría: queda fuera de alcance de `002` (spec §5). Los datos se acumulan sin que nadie los lea hasta `010`.
- No hay política de retención. Con un solo tipo de evento el volumen es despreciable; `010` tiene que definirla antes de sumar eventos de alta frecuencia.

## Alternativas consideradas

- **Postergar el AC-2.2 hasta `010`:** dejaba `002` con un criterio de aceptación sin cumplir y perdía el registro de todos los cambios de prioridad hechos mientras tanto — justo los datos que `006-priority-reallocation` va a querer mirar.
- **Tabla específica `project_priority_changes`:** más simple ahora, pero garantiza una migración de datos cuando `010` cree su tabla genérica. Se prefirió pagar el diseño genérico una vez.
- **Escribir el registro desde el route handler en vez de un trigger:** se descartó porque un cambio de prioridad hecho por fuera de la API (script, consola de Supabase, futura feature) no quedaría auditado. El trigger cubre todos los caminos.
