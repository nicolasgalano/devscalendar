# Plan — Saldar la deuda registrada que queda

- **ID:** 013-registered-debt-cleanup
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Una migration para las dos deudas que tocan policies (F7 y D-08) y cambios
locales para las otras tres. Lo único que cambia comportamiento es **quién puede
leer los maestros**; el resto es vocabulario, orden y códigos de error.

---

## 2. Modelo de datos

Una migration, `00000000000010_debt_cleanup.sql`. **Sin cambios de esquema:** no
hay columnas ni tablas nuevas, solo tres policies recreadas.

### 2.1 F7 — leer maestros exige estar dado de alta

```sql
drop policy "clients: authenticated read" on public.clients;
create policy "clients: authenticated read"
  on public.clients for select to authenticated
  using (public.has_any_role());
```

Ídem `projects: authenticated read`. `has_any_role()` ya incluye `and active`
desde `012`, así que esto alinea las cuatro tablas —`bookings`, `profiles`,
`clients`, `projects`— con el mismo criterio, y AC-1.3 sale gratis.

**El nombre de la policy se conserva** aunque ya no diga la verdad entera
("authenticated" pasó a ser "authenticated con rol"): renombrarla obligaría a
buscarla por otro nombre en las tres migrations que la mencionan y en los tests,
a cambio de nada. El comentario de la migration lo aclara.

### 2.2 D-08 — un proyecto desactivado no acepta reservas nuevas

**En la policy de `insert`, no en `can_manage_booking()`.** Es la decisión de
diseño de esta feature y la única con una trampa (R-2 de la spec): esa función la
comparten las policies de insert y de update y también `reallocate_booking()`, así
que meter el chequeo ahí congelaría las reservas existentes de un proyecto dado
de baja — justo lo que su PM necesita poder cancelar.

```sql
drop policy "bookings: manager insert" on public.bookings;
create policy "bookings: manager insert"
  on public.bookings for insert to authenticated
  with check (
    public.can_manage_booking(project_id)
    and exists (select 1 from public.projects where id = project_id and active)
  );
```

`bookings: manager update` **no se toca**: cancelar y editar siguen andando
(AC-4.2). `reallocate_booking()` tampoco: ya chequeaba `p.active` con `DC004`.

Arriba de la policy, el handler `POST /api/bookings` suma el chequeo con un 400
legible, igual que hace con el `active` del desarrollador. Sin él, la policy
filtra y la API devolvería un error de RLS sin explicar cuál de las dos cosas
falló.

---

## 3. Cambios por deuda, fuera de la migration

### D-02 — registrar el desvío

`001/spec.md` AC-1.3 gana la nota del desvío: la sesión sobrevive a propósito y
`/pending-access` es la consecuencia. Es documentación, pero es la mitad que
explica por qué existía F7.

### D-03 — orden por PM primario

`getBookingOptions()` (`src/lib/bookings/options.ts`) ya trae los devs activos;
suma `primary_pm_id` al `select` y ordena en memoria:

```ts
const mine = devs.filter((d) => d.primary_pm_id === viewer.id);
const rest = devs.filter((d) => d.primary_pm_id !== viewer.id);
```

**En memoria y no en el query**: son decenas de filas, ya vienen ordenadas por
nombre, y un `order` de PostgREST no expresa "primero los que matchean" sin un
campo calculado. La función pura que decide el orden vive aparte para poder
testearla sin base.

**Para el admin no se reordena** (AC-2.2): no tiene devs propios, y un orden que
cambie según quién mira sin que nada lo diga es peor que el alfabético.

Y la columna **PM primario sale de la tabla** de `/admin/users` — encabezado y
celda—; el campo sigue en el diálogo de edición.

### D-04 — los cuatro `SelectValue` que quedan

`012` se llevó dos al matar el `Select` de rol. Quedan cuatro, y el arreglo es el
que ya usan `booking-dialog.tsx` y `calendar-filters.tsx`: resolver el texto a
mano adentro de `<SelectValue>`.

| Pantalla | Select | Hoy muestra |
| :-- | :-- | :-- |
| `/admin/users` | PM primario | `__none__` o el uuid |
| `/admin/projects` | Cliente | el uuid |
| `/admin/projects` | PM responsable | el uuid |
| `/admin/projects` | Prioridad | `normal` / `high` |

`pmLabel()` ya existe en `users-table.tsx`; para prioridad hace falta un mapa de
etiquetas, que se escribe al lado de las opciones que ya dicen `Común` y
`Prioritario`.

### D-05 — `readJsonBody()` en los seis handlers

`clients`, `clients/[id]`, `projects`, `projects/[id]`, `users`, `users/[id]`.
Una línea por handler: `await request.json()` → `await readJsonBody(request)`.
El schema de Zod ya rechaza `undefined` con el 400 de siempre.

### D-06 — achicarla

Dos tests E2E más en `admin-entities.spec.ts`:

1. Un **PM** rebota de `/admin/users` y de `/admin/projects` —hoy solo se prueba
   `/admin/clients` con un developer— y no ve la sección en la navegación.
2. Ese mismo PM recibe **403** de `POST /api/clients`, `/api/projects` y
   `/api/users`.

Después de eso, lo único que queda de D-06 es la confirmación con una cuenta de
Google real, porque los E2E plantan la cookie de sesión en vez de pasar por
OAuth.

---

## 4. Riesgos y mitigaciones

- **R-1 — F7 puede romper una lectura que no vimos.** **Mitigación:** los tests
  de integración cubren los tres actores (con rol, sin rol, desactivado), y el
  E2E del calendario ya recorre la pantalla que más lee maestros.
- **R-2 — El chequeo de D-08 en el lugar equivocado.** Ver §2.2: va en `insert`,
  con un test que confirma que cancelar sigue funcionando.
- **R-3 — La migration vuelve a tocar policies de lectura.** Menos peligrosa que
  la de `012` —no borra nada— pero el mismo cuidado: cada policy recreada tiene
  su test que **lee las filas de vuelta**.

---

## 5. Testing strategy

- **Unit** — la función pura de orden de D-03: PM con devs propios, PM sin
  ninguno, admin (no reordena), y que **ningún dev se pierda** en ninguno de los
  tres casos.
- **Integración** — F7 con los tres actores sobre `clients` y `projects`; D-08
  insertando sobre un proyecto desactivado (cero filas) y cancelando una reserva
  existente de ese mismo proyecto (sí funciona).
- **E2E** — los dos de D-06.
- **Manual** — los cuatro `Select` de D-04 necesitan ojos: que el trigger diga lo
  que corresponde es exactamente lo que no se ve en un assert de texto sin
  reproducir la pantalla.

---

## 6. Rollout

`pnpm db:push` → `pnpm db:types` (no cambia el esquema, pero se corre igual para
confirmarlo) → CI → push a `main`.

**Sin ventana de incompatibilidad esta vez:** la migration no borra ninguna
columna, así que el código viejo sigue funcionando mientras el deploy sale. Es la
diferencia con `012`, y vale la pena decirla: lo que hacía peligrosa a aquella no
era tocar policies, era el `drop column`.
