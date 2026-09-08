# Plan — Roles múltiples y `active` con dientes

- **ID:** 012-multiple-roles-and-active-enforcement
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

`profiles.role` (un `user_role`) pasa a `profiles.roles` (`user_role[]`), y
`current_user_role()` —que devolvía _un_ rol y era la puerta de siete policies—
se reemplaza por dos funciones de **pertenencia**: `has_role(user_role)` y
`has_any_role()`. Las dos incluyen `and active`, así que **D-01 se salda dentro
de la misma función que resuelve D-09**: cada policy que hoy pregunta "¿sos
admin?" pasa a preguntar "¿sos un admin activo?" sin que haya que tocarla dos
veces.

Arriba de eso, la app deja de comparar un rol con `===` y pasa a preguntar por
pertenencia; el shell arma la navegación por unión; y `/admin/users` cambia un
`Select` por tres checkboxes.

---

## 2. Arquitectura

Lo único que cambia de forma es de dónde sale la respuesta a "¿qué puede hacer
esta persona?". Hoy son dos preguntas distintas hechas en dos lugares —el rol en
la base, el `active` en un layout de UI—; después es una sola, y vive abajo.

```
                          ANTES                                DESPUÉS

  (app)/layout.tsx ─── active? ──┐              (app)/layout.tsx ─── UX nomás
                                 │                     │
  policies ─── current_user_role() = 'admin'     policies ─── has_role('admin')
                    │                                              │
                    └── profiles.role (uno)                        └── profiles.roles (conjunto)
                                                                        + active  ← D-01
```

El layout sigue redirigiendo al desactivado, pero deja de ser **la** garantía y
pasa a ser lo que siempre debió: la versión amable de una regla que ya se
cumple abajo.

---

## 3. Modelo de datos

Todo en **una** migration, `00000000000009_multiple_roles_and_active.sql`.

### 3.1 Cambios a tablas existentes

- **`profiles`**: `roles public.user_role[] not null default '{}'`, backfilleada
  desde `role`; después se borra `role`.
- **`profile_invites`**: `roles public.user_role[] not null`, backfilleada desde
  `role`; después se borra `role`.

```sql
alter table public.profiles add column roles public.user_role[] not null default '{}';
update public.profiles set roles = case when role is null then '{}'::public.user_role[]
                                        else array[role] end;
```

**Sin duplicados, por trigger y no por constraint.** Un `check` no puede llevar
subconsulta, así que "el array no repite valores" no se expresa ahí. Se
normaliza al escribir —ordenado y sin repetidos— con un `before insert or
update`, que además hace que dos conjuntos iguales se guarden idénticos y las
comparaciones de los tests no dependan del orden en que la UI mandó los
checkboxes.

### 3.2 Las dos funciones nuevas

```sql
create or replace function public.has_role(target public.user_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and target = any(roles)
  );
$$;

create or replace function public.has_any_role()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and cardinality(roles) > 0
  );
$$;
```

`security definer` por el mismo motivo que `current_user_role()`: leer `profiles`
desde adentro de una policy de `profiles` es recursión. Llevan `revoke all from
public` y `grant execute to authenticated`, igual que la que reemplazan.

**El `and active` es D-01, y es el corazón de este plan.** Un solo lugar decide
que un desactivado no es nadie, y siete policies lo heredan.

### 3.3 Las policies que hay que recrear — la lista completa

Postgres no deja borrar una función de la que dependen policies, así que el orden
es: crear las funciones nuevas → recrear las policies → borrar
`current_user_role()`. **Ninguna puede quedar afuera**, y por eso están
enumeradas acá y no "las que usen la función":

| #   | Policy                          | Migration  | Hoy                               | Después                                         |
| :-- | :------------------------------ | :--------- | :-------------------------------- | :---------------------------------------------- |
| 1   | `profiles: admin read all`      | `…0000:75` | `current_user_role() = 'admin'`   | `has_role('admin')`                             |
| 2   | `profiles: admin write`         | `…0000:81` | ídem (`for all`)                  | `has_role('admin')`                             |
| 3   | `clients: admin write`          | `…0001:64` | ídem                              | `has_role('admin')`                             |
| 4   | `projects: admin write`         | `…0001:75` | ídem                              | `has_role('admin')`                             |
| 5   | `profile_invites: admin all`    | `…0002:32` | ídem                              | `has_role('admin')`                             |
| 6   | `audit_log: admin read`         | `…0003:33` | ídem                              | `has_role('admin')`                             |
| 7   | `bookings: team read`           | `…0004:82` | `current_user_role() is not null` | `has_any_role()`                                |
| 8   | `profiles: team directory read` | `…0005:18` | `role is not null`                | `cardinality(roles) > 0`                        |
| 9   | `bookings: developer responds`  | `…0007:38` | `dev_id = auth.uid()`             | `dev_id = auth.uid() and has_role('developer')` |

**La 8 no lleva `active` y es a propósito** (R-5 de la spec): mira la fila que se
lee, no a quien lee, y el calendario muestra el nombre del dev asignado en cada
bloque. Filtrar por `active` ahí le borraría el nombre a las reservas de alguien
dado de baja — el bug exacto que arregló `…0005`.

**`profiles: self read` (`…0000:69`) no se toca**, y también es a propósito
(R-4): es `auth.uid() = id`, no pasa por ninguna función de rol, y es lo que
permite que `/pending-access` le diga algo a un desactivado en vez de dejarlo
rebotando.

### 3.4 Las funciones que además cambian de contenido

- **`can_manage_booking()`** (`…0006:44`) — `create or replace`. El admin pasa por
  `has_role('admin')`; la rama del PM suma el `active` que hoy no mira:

  ```sql
  select public.has_role('admin')
      or exists (
        select 1 from public.projects p
        join public.profiles me on me.id = auth.uid()
        where p.id = target_project and p.pm_id = auth.uid() and me.active
      );
  ```

- **`reallocate_booking()`** (`…0008`) — `create or replace`. Solo el chequeo del
  desarrollador: `role = 'developer'` → `'developer' = any(roles)`. Los dos
  `active` que ya tenía se quedan como están; esta función era la que lo hacía
  bien.

- **`handle_new_user()`** (`…0002`) — `create or replace`. Consume
  `profile_invites.roles` en vez de `role`, y el default sin invitación es `'{}'`
  en vez de `null` (AC-1.5).

### 3.5 Índices

`profiles_active_role_idx on (role) where active` deja de tener columna. Se
reemplaza por un GIN, que es lo que sirve para `roles @> '{pm}'`:

```sql
drop index public.profiles_active_role_idx;
create index profiles_roles_idx on public.profiles using gin (roles);
```

Sin `where active`: un índice parcial no lo puede usar una consulta que no filtre
por `active`, y varias de las nuestras no lo hacen.

### 3.6 Orden de la migration

1. `roles` en `profiles` y en `profile_invites`, con backfill.
2. Trigger de normalización.
3. `has_role()` y `has_any_role()`.
4. Recrear las nueve policies de §3.3.
5. `create or replace` de `can_manage_booking()`, `reallocate_booking()` y
   `handle_new_user()`.
6. `drop function current_user_role()`.
7. `drop column role` en las dos tablas.
8. Índices.

---

## 4. API surface

**No hay rutas nuevas ni contratos nuevos de recurso.** Cambian dos payloads:

| Método | Ruta              | Cambio                                            |
| :----- | :---------------- | :------------------------------------------------ |
| POST   | `/api/users`      | `role: UserRole` → `roles: UserRole[]` (mínimo 1) |
| PATCH  | `/api/users/[id]` | ídem, opcional                                    |

`src/lib/validation/users.ts`:

```ts
export const userRolesSchema = z.array(userRoleSchema).min(1).max(3);
```

El `min(1)` es AC-1.4: quedarse sin roles no es la forma de dar de baja. El
`max(3)` no es defensa, es documentación — son tres valores y no hay repetidos
(el trigger normaliza, pero rechazar temprano da mejor mensaje).

### Los guards

- **`requireAdmin()`** — hoy selecciona **solo `role`** (`require-admin.ts:28-32`).
  Pasa a `roles, active` y exige las dos cosas. Es el arreglo de D-01 en el
  camino de API.
- **`requireBookingAccess()`** — usa `getCurrentProfile()`, que **ya trae**
  `active` y nunca lo consultaba. Ahora sí, y el admin se resuelve por
  pertenencia.
- **`requireBookingResponder()`** — mismo tratamiento: el dev desactivado no
  responde.

Las tres validaciones de `role !== "pm"` (`api/projects/route.ts:29`,
`api/projects/[id]/route.ts:33`, `api/users/[id]/route.ts:33`) y las dos de
`role !== "developer"` (`api/bookings/route.ts:31`,
`api/bookings/[id]/route.ts:106`) pasan a preguntar por pertenencia.

> **Nota sobre `api/bookings/[id]` (D-07):** ese handler pide **solo `role`** y no
> mira `active`, así que hoy no se puede _crear_ una reserva para un dev
> desactivado pero sí _mover_ una encima de él. Es D-07, y su propia entrada dice
> que se salda con D-01. **Queda fuera de esta feature salvo OK explícito**; si
> se da, es una línea en el mismo `select`.

### Filtros de PostgREST

Los cinco `.eq("role", …)` pasan a `.contains("roles", [...])`, que en el cable es
`roles=cs.{pm}`. **Eso no lo verifica el typechecker ni un mock**: un filtro
inválido compila igual y falla en runtime. Va con smoke test (T4.4).

---

## 5. UI

### `/admin/users` — de un `Select` a tres checkboxes

`checkbox.tsx` ya está instalado, así que no hay componente nuevo que agregar
(ADR 0003/0006: se ajustan a la escala de densidad al instalarlos, y este ya
pasó por ahí).

- **Diálogo de invitar y de editar** — los tres roles como checkboxes con su
  `Label`, en el orden `Admin · PM · Developer`. El botón de guardar se
  deshabilita con cero marcados, y el mensaje dice por qué (AC-1.4). El copy sale
  del vocabulario de la UI, no del de la base (`DESIGN.md` §11).
- **Columna Rol de la tabla** — pasa a listar varios. Con `badge.tsx` ya
  instalado, un badge por rol y `Sin rol` en itálica cuando el conjunto está
  vacío, que es como se ve hoy.

> **Ojo con D-04 al tocar este archivo:** los `<SelectValue>` sin hijos de
> `users-table.tsx` imprimen el valor crudo (`__none__`, uuids, `developer`). El
> `Select` de rol desaparece con este cambio, así que **dos de los seis casos de
> D-04 se van solos**; los otros cuatro —PM primario, y los tres de
> `projects-table.tsx`— **no se tocan**: son D-04 y necesitan su propio OK.

### El shell

`AppShell` recibe `roles: UserRole[]` en vez de `role`, y los `extras` dejan de
ser un `if / else if` para ser unión (AC-4.1):

```ts
const extras = [
  ...(roles.includes("developer") ? [DEVELOPER_NAV_ITEM] : []),
  ...(roles.includes("admin") ? [TEAM_PENDING_ITEM] : []),
];
```

El comentario que hoy explica por qué se pasa el rol entero y no un `isAdmin`
—"con `005` ya son dos los que abren navegación propia"— se actualiza: ahora el
motivo es más fuerte, porque los dos pueden ser la misma persona.

### El resto

- `(app)/layout.tsx` — `!profile.role` → `profile.roles.length === 0`.
- `(app)/admin/layout.tsx` — `role !== "admin"` → no tiene `admin` en `roles`.
- `(app)/inbox/layout.tsx` — ídem con `developer`. **La bandeja sigue siendo solo
  del dev**, y ahora eso incluye al admin que además es dev: el criterio nunca
  fue "no ser admin", era "ser el dev".
- `calendar/page.tsx:104` — el `BookingViewer` lleva `roles`.

### Un módulo nuevo, `src/lib/auth/roles.ts`

Funciones puras, sin Supabase: `hasRole(roles, r)`, `isAdmin(roles)`,
`canBePm(roles)`, `ROLE_LABEL` y `formatRoles(roles)`. Existe para que la
pregunta se escriba una sola vez y para tener qué testear sin base — hoy
`ROLE_LABEL` vive suelto en `users-table.tsx:52` y no lo puede usar nadie más.

---

## 6. Integraciones externas

Ninguna.

---

## 7. Dependencias entre features

- **Necesita:** `001` y `002` mergeadas (lo están), y Q-A y Q-6 respondidas (lo
  están, 2026-09-07).
- **Desbloquea:** `010`, que necesita que `projects.pm_id` pueda nombrar a quien
  realmente lleva el proyecto.
- **No toca** `003`, `004`, `005`, `006` en su lógica — sí en cómo preguntan por
  el rol.

---

## 8. Riesgos y mitigaciones

- **R-1 — Una policy que se olvida queda apuntando a una función que ya no
  existe.** Postgres no deja borrar la función si algo depende de ella, así que
  el síntoma sería la migration fallando, no un agujero silencioso. **Es la buena
  noticia del diseño:** el error sale al aplicar, no en producción. La lista de
  §3.3 existe igual para que el review sepa contra qué comparar.

- **R-2 — Un `update` filtrado por RLS no falla.** Todo test lee la fila de
  vuelta con `service_role` (§10).

- **R-3 — Ventana de incompatibilidad con el deploy.** La migration borra
  `profiles.role`, que es lo que lee el código deployado. `db:push` primero y
  push a `main` inmediatamente después; hoy no hay usuarios, así que la ventana
  no le cuesta a nadie. **Con usuarios reales esto exigiría dos fases** y hay que
  decirlo en el `tasks.md` para la próxima.

- **R-4 — `db:types` necesita la migration aplicada en el remoto.** Es el mismo
  orden que se usó en `006` T1.4, donde encontró un error real de nulabilidad
  que ningún test unitario habría visto. Se repite: `db:push`, `db:types`, y
  recién después el código que consume los tipos.

- **R-5 — El seed y las fixtures escriben `role`.** `supabase/seed.sql`,
  `tests/e2e/session.ts:createUser` y los helpers de integración. Si se olvida
  alguno, la suite entera se cae con un error de columna inexistente — ruidoso,
  no silencioso.

---

## 9. Alternativas consideradas

- **Tabla `profile_roles` (junction) en vez de un array.** Es la forma
  normalizada y la que elegiría con roles por proyecto o con permisos
  arbitrarios. Se descarta porque acá el conjunto es de tres valores fijos y
  globales: el array los deja en la fila que `getCurrentProfile()` ya lee una vez
  por request, así que la pregunta de pertenencia no agrega ni una consulta ni un
  embed. Con una tabla aparte, `has_role()` pasa a ser un join y `profiles`
  necesita traerse sus roles por separado en cada pantalla que los muestre.
  **Es reversible:** si algún día los roles se vuelven por proyecto, la tabla es
  el camino y el array se migra a ella sin tocar la API.

- **Aceptar `admin` donde hoy se exige `pm`** (cinco líneas, sin migration). Era
  el atajo que la deuda D-09 nombró y descartó: deja el modelo mintiendo —la
  persona _no_ es PM, la app finge que sí— y no arregla la columna `Rol` de
  `/admin/users`, que seguiría mostrando uno solo. Sobre todo, no arregla lo que
  motiva la deuda: `010` seguiría notificando a un `pm_id` elegido por descarte.

- **Dejar `role` como columna generada (`roles[1]`) para no romper el deploy.**
  Compraría la ventana de R-3 a cambio de arrastrar una columna mentirosa —¿cuál
  es "el" rol de alguien con dos?— y de que el código viejo que _escribe_ `role`
  falle igual. Con usuarios reales la respuesta correcta no es esta sino la
  migración en dos fases.

- **Chequear `active` solo en los guards de API y no en la base.** Más barato y
  deja el agujero: `service_role` no, pero cualquier camino nuevo que hable
  directo con PostgREST —incluida la propia app desde un Client Component— se
  saltearía el chequeo. La lección de ADR 0010 es justamente que la regla tiene
  que estar donde no se pueda esquivar.

---

## 10. Testing strategy

- **Unit** — `src/lib/auth/roles.ts` completo, y `permissions.ts` con viewers de
  uno y de dos roles: `canManageProject` para un `pm+admin` sobre un proyecto
  ajeno (puede, por admin) y para un `pm` puro sobre el mismo (no puede).
- **Integración (DB)** — una por policy tocada, **leyendo la fila de vuelta**:
  1. Admin **activo** escribe en `clients` / `projects` / `profiles`; admin
     **desactivado** afecta cero filas en las tres. Es AC-3.1 a nivel base.
  2. PM desactivado no puede insertar en `bookings`.
  3. Dev desactivado no puede responder su propia reserva (AC-3.3).
  4. Un desactivado **sí** lee su propia fila de `profiles` (AC-3.4) y **no** lee
     `bookings` (`bookings: team read` ahora exige `has_any_role()`).
  5. Un dev desactivado **sigue visible** en el directorio, o sus reservas
     pierden el nombre (AC-3.5).
  6. `has_role()` con conjunto de dos: alguien con `pm+admin` pasa las policies de
     admin y además puede ser `pm_id` de un proyecto.
  7. `handle_new_user()` aplica el conjunto de la invitación entero (AC-1.3).
- **Smoke** — los filtros `roles=cs.{...}` contra PostgREST (§4). Un `.contains`
  mal escrito typechequea igual.
- **E2E** — el caso que hoy no se puede escribir: un usuario con `pm` **y**
  `admin` entra a `/admin/*`, aparece en el desplegable de PM responsable, y ve
  su navegación con las dos secciones (AC-2.1, AC-2.2, AC-4.1). Más el negativo:
  un admin desactivado va a `/pending-access` y su POST a `/api/clients` da 403.
- **Manual** — la selección múltiple de roles en `/admin/users` con ojos humanos
  (`DESIGN.md` checklist), y **de paso la verificación pendiente de D-06**, que
  necesita las mismas sesiones reales.

---

## 11. Rollout

- **Feature flag:** no. Es un cambio de esquema; un flag no puede tener las dos
  formas de la columna a la vez.
- **Migración destructiva:** **sí** — `drop column role` en dos tablas y
  `drop function current_user_role()`. El backfill es previo y en la misma
  transacción.
- **Rollback:** revertir el commit no alcanza, porque la columna ya no está. El
  camino de vuelta es una migration inversa (`role` de vuelta, backfill con
  `roles[1]`, funciones viejas). **Se escribe solo si hace falta**; hoy no hay
  datos que perder y el proyecto se puede recrear desde el dashboard.
- **Orden obligatorio:** `pnpm db:push` → `pnpm db:types` → código → CI verde →
  push a `main` (que dispara el deploy). Ver R-3: entre el primero y el último
  hay una ventana con el sitio roto, y hoy eso es aceptable porque no hay
  usuarios. **La próxima vez que esto pase, con gente adentro, va en dos fases.**
