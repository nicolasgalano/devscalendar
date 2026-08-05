# 0004 — Invitación por email: el rol se pre-asigna y el trigger lo consume

- **Estado:** accepted
- **Fecha:** 2026-08-04

## Contexto

La feature `002-entities-admin` (AC-3.1) pide que un admin pueda dar de alta un usuario indicando email y rol, **antes** de que esa persona haya entrado alguna vez. Pero el flujo de auth de `001-auth-and-permissions` es Google OAuth: el `profile` recién existe cuando la persona se loguea, y el trigger `handle_new_user` lo crea siempre con `role = null`, lo que la manda a `/pending-access`.

O sea: sin cambios, dar de alta un usuario por email era imposible. Alguien tenía que esperar a que la persona entrara y recién ahí asignarle el rol a mano — exactamente la fricción que AC-3.1 quiere eliminar.

## Decisión

Se agrega una tabla `profile_invites (email → role)` y se extiende `handle_new_user()` para que, al crear el profile, busque una invitación por email: si hay match hereda ese rol y **borra la invitación**; si no, cae al comportamiento actual (`role = null`).

El usuario invitado sigue entrando con Google OAuth como cualquier otro. Lo único que cambia es que su profile nace con el rol ya puesto en vez de nulo. No es un sistema de invitaciones por email: no se manda ningún mail, no hay link mágico, no hay token.

`POST /api/users` decide sola contra qué escribir: si ya existe un profile con ese email y sin rol, se lo asigna directo; si existe con rol, responde 409; si no existe, inserta la invitación.

## Consecuencias

**Positivas:**

- El admin puede dejar el sistema listo para operar antes de que el equipo entre por primera vez, que es la métrica de éxito de la spec de `002`.
- No se toca el flujo de login: un solo mecanismo de auth en todo el producto.
- La invitación se consume sola. No hay estado que limpiar ni invitaciones que caduquen a mano.

**Negativas / a mitigar:**

- Modifica un objeto que es dueño de `001` (`handle_new_user`). Mitigación: el camino sin invitación queda idéntico, y hay tests de regresión que cubren ambas ramas (`tests/integration/profile-invites.test.ts`).
- Una invitación mal tipeada queda colgada para siempre sin que nadie se entere. Hoy se ven en `/admin/users` bajo "Invitaciones pendientes" y se pueden borrar; no hay expiración automática.
- El match es por igualdad exacta de email. Si la persona entra con un alias de Google distinto al invitado, la invitación no aplica y cae en `/pending-access`. Aceptable: el admin la resuelve a mano.

## Alternativas consideradas

- **`inviteUserByEmail` de Supabase:** manda un mail con magic link y crea el usuario. Descartado porque introduce un segundo mecanismo de login (magic link) solo para invitados, en un producto que ya está 100% comprometido con Google OAuth. Más superficie de auth para mantener y testear, sin beneficio real: el invitado igual va a entrar con Google.
- **Asignar el rol a mano después del primer login:** es el estado previo. Funciona pero obliga a coordinar ("entrá y avisame que te doy permisos"), y no cumple AC-3.1.
- **Columna `pending_role` en `profiles` con filas huérfanas:** requeriría crear profiles sin `auth.users` asociado, rompiendo la FK `profiles.id → auth.users.id` que es la base del modelo de permisos.
