# Spec — Roles múltiples y `active` con dientes

- **ID:** 012-multiple-roles-and-active-enforcement
- **Estado:** ready-to-plan
- **Referencias en la spec funcional:** §3 (roles y permisos), §12 (seguridad)
- **Origen:** no sale de la spec funcional sino del registro de deuda —
  **D-09** y **D-01** de `docs/deuda-tecnica.md`—, con OK explícito del usuario
  del 2026-09-08 para saldarlas. **D-01 es gate antes del primer usuario real** y
  **D-09 es gate antes de `010`**.

---

## 1. Objetivo

Que una persona pueda **tener varios roles a la vez** —hoy `profiles.role` guarda
uno solo y en el equipo hay gente que es PM y admin—, y que **desactivar a
alguien le saque los permisos de verdad** y no solo le esconda la pantalla.

Son dos deudas distintas y van juntas por una razón concreta: las dos reescriben
`current_user_role()`, que es la puerta de casi todas las policies. Hacerlas
por separado es escribir dos migrations sobre la misma función, con dos rondas
de tests de integración, y dejar la app a mitad de camino entre las dos.

---

## 2. Contexto

**D-09 — un rol por persona.** `user_role` es un enum de un solo valor y
`profiles.role` guarda uno solo, así que quien es PM y admin tiene que elegir:

- Con `admin` entra a `/admin/*` y opera todo, pero **ningún proyecto puede
  nombrarlo responsable** — `projects.pm_id` exige `role = 'pm'` exacto en tres
  lugares—, así que cada uno de "sus" proyectos lleva a otra persona en `pm_id`.
- Con `pm` puede ser responsable, pero pierde `/admin/*` entero.

Para _operar_ reservas eso casi no se nota, porque `admin` ya es superconjunto de
`pm`. El problema es de **pertenencia**, y su consecuencia peor todavía no se ve:
las notificaciones de `010` salen hacia el `pm_id` del proyecto. Si el
responsable nominal no es quien realmente lo lleva, el aviso de "te desplazaron
una reserva confirmada" **le llega a la persona equivocada** — y ese aviso es el
que justifica que `010` sea gate antes del primer deploy con usuarios reales.

**D-01 — `active = false` solo se aplica en la UI.** El único lugar del camino de
autorización que mira `profiles.active` es `src/app/(app)/layout.tsx:26`, que es
un layout de UI. No hay layout en `/api/*`, y ninguna policy mira `active`. Un
admin desactivado sigue creando clientes, proyectos y usuarios por API; un PM
desactivado sigue creando y cancelando reservas; un dev desactivado sigue
aprobando las suyas. Y no hace falta una sesión vieja: volver a loguearse con
Google le devuelve sesión, y el middleware lo deja pasar.

Que es un descuido y no una decisión lo prueba `reallocate_booking()`, el camino
más nuevo, que **sí** chequea `active` del proyecto y del desarrollador
(`…0008:85,101`, error `DC004`).

---

## 3. User stories

- **US-1** — Como Admin, quiero asignarle **más de un rol** a una persona, para
  que quien es PM y admin no tenga que elegir.
- **US-2** — Como PM que además es Admin, quiero **poder ser el responsable de
  mis proyectos** sin perder el panel de administración, para que el proyecto
  diga la verdad sobre quién lo lleva.
- **US-3** — Como Admin, quiero que **desactivar a alguien le saque el acceso de
  verdad** —API y base, no solo la pantalla—, para que dar de baja a una persona
  sea una decisión y no una sugerencia.
- **US-4** — Como cualquier usuario, quiero que la navegación me muestre **todo
  lo que mis roles habilitan**, para no perder una sección por tener dos roles en
  vez de uno.

---

## 4. Acceptance criteria

### US-1 — Varios roles por persona

- **AC-1.1** — Given un Admin en `/admin/users`, when edita a un usuario, then
  puede marcar **uno o más** roles de `admin`, `pm`, `developer`, y guardar.
- **AC-1.2** — Given un usuario con roles `pm` y `admin`, when se lista en
  `/admin/users`, then la columna Rol muestra **los dos**, con el vocabulario de
  la UI (`Admin`, `PM`, `Developer`), nunca el valor crudo de la base.
- **AC-1.3** — Given un Admin invita a alguien por email, when elige los roles,
  then la invitación guarda el **conjunto** y el primer login lo aplica entero.
- **AC-1.4** — Given un intento de guardar un usuario **sin ningún rol**, when se
  envía, then la API responde 400. Quitarle todos los roles a alguien no es la
  forma de darlo de baja — para eso está `active`.
- **AC-1.5** — Given un usuario que nunca fue invitado ni tiene rol asignado,
  when entra por primera vez, then su perfil nace **con el conjunto vacío** y cae
  en `/pending-access`, igual que hoy.

### US-2 — Pertenencia sin exclusividad

- **AC-2.1** — Given una persona con roles `pm` y `admin`, when un Admin crea o
  edita un proyecto, then esa persona **aparece en el desplegable de PM
  responsable** y puede quedar asignada en `projects.pm_id`.
- **AC-2.2** — Given esa misma persona, when abre `/admin/*`, then entra: tener
  `pm` además de `admin` no le quita nada.
- **AC-2.3** — Given el desplegable de PM primario de un usuario
  (`profiles.primary_pm_id`), when se abre, then lista a **todo el que tenga el
  rol `pm`**, tenga o no otros roles.
- **AC-2.4** — Given una persona con roles `developer` y `pm`, when abre el
  calendario, then ve **su bandeja** (por `developer`) **y** el botón de crear
  reserva (por `pm`), en la misma pantalla.

### US-3 — `active` con dientes

- **AC-3.1** — Given un usuario **desactivado** con rol `admin`, when llama a
  `POST /api/clients`, `/api/projects` o `/api/users`, then recibe **403**, no un 201.
- **AC-3.2** — Given un PM desactivado, when intenta crear, editar o cancelar una
  reserva por API, then recibe 403 — y si algo se colara hasta la base, **la RLS
  lo filtra**.
- **AC-3.3** — Given un desarrollador desactivado, when intenta aprobar o
  rechazar una reserva propia, then la base lo rechaza: la policy
  `bookings: developer responds` deja de ser `dev_id = auth.uid()` a secas.
- **AC-3.4** — Given un usuario desactivado, when vuelve a loguearse con Google,
  then obtiene sesión y termina en `/pending-access` — **puede leer su propio
  perfil y nada más**. Esto es deliberado: sin poder leerse a sí mismo no se le
  puede mostrar el cartel.
- **AC-3.5** — Given un desarrollador desactivado que ya tiene reservas
  cargadas, when alguien mira el calendario, then **las reservas siguen
  mostrando su nombre**. Desactivar no reescribe la historia (es el motivo por el
  que existe la policy `profiles: team directory read`, ver ADR/migration `…0005`).

### US-4 — Navegación por unión

- **AC-4.1** — Given un usuario con `developer` y `admin`, when carga el shell,
  then la navegación muestra **su bandeja y el panel de administración**, no uno
  de los dos.
- **AC-4.2** — Given un usuario con un solo rol, when carga el shell, then ve
  exactamente lo que veía antes de esta feature.

---

## 5. Alcance

### Dentro

- `profiles.role` (singular) pasa a un **conjunto de roles**, y
  `profile_invites.role` con él.
- `current_user_role()` se reemplaza por funciones de **pertenencia**, y todas
  las policies que la usaban se recrean.
- El chequeo de `active` entra en el camino de autorización: funciones de la
  base, policies, y los guards de `src/lib/api/`.
- Los tres lugares que exigen `role = 'pm'` exacto pasan a preguntar por
  pertenencia; los dos que exigen `role = 'developer'`, igual.
- La UI de `/admin/users` pasa de un `Select` de rol a selección múltiple, y la
  columna Rol a listar varios.
- El shell arma la navegación por **unión** de lo que habilita cada rol.
- ADR propio, y revisión del texto de 0009 y 0010.
- Tests: unitarios de las funciones puras, de integración para cada policy
  tocada **leyendo la fila de vuelta**, smoke para los filtros nuevos de
  PostgREST, y E2E del caso que hoy no se puede escribir: alguien con `pm` +
  `admin`.

### Fuera (explícito)

- **Varios PMs por proyecto.** Q-A se respondió el 2026-09-07: un PM primario
  obligatorio. `projects.pm_id` sigue siendo singular y `not null`.
- **El rol Cliente.** Q-6 se respondió el 2026-09-07: no accede. El conjunto de
  valores posibles sigue siendo `admin`, `pm`, `developer`.
- **D-08** — reservar sobre un proyecto desactivado. Es de la misma familia que
  D-01 pero no está anotada como parte de ella; se salda con su propio OK.
- **Aprobar sigue siendo de identidad, no de rol** (ADR 0009). Nada de esta
  feature le da al admin un atajo para aprobar: el trigger compara `auth.uid()`
  contra `dev_id` y así se queda.
- **Permisos por proyecto o por cliente.** Los roles siguen siendo globales.
- **D-03 (`primary_pm_id` a medio implementar)**, D-04 y D-05. Se rozan, no se
  tocan.

---

## 6. Dependencias

- **001-auth-and-permissions** — es la feature dueña del enum, de `profiles` y de
  `current_user_role()`.
- **002-entities-admin** — dueña de `/admin/users`, de `profile_invites` y de las
  tres validaciones de `role = 'pm'`.
- **Q-A y Q-6 respondidas** (2026-09-07). Eran los dos prerequisitos de producto
  de D-09; sin ellos esta feature no se podía empezar.
- **Desbloquea `010`**, que necesita que `pm_id` diga la verdad para que las
  notificaciones lleguen a quien corresponde.

---

## 7. Preguntas abiertas

- **Q-Q1** — ¿Un usuario puede quedarse **sin ningún rol** desde la UI? **Default
  aplicado:** no — AC-1.4 lo rechaza con 400. Quitar todos los roles se parece a
  dar de baja, y para eso está `active`, que además preserva el motivo. El
  conjunto vacío existe solo para quien nunca fue dado de alta (AC-1.5).
- **Q-Q2** — ¿Un admin puede **desactivarse a sí mismo**, o quitarse el rol
  `admin`? **Default aplicado:** sí, no se agrega ninguna protección especial.
  Con más de un admin no es un problema, y con uno solo el arreglo es por base.
  Anotado por si el equipo prefiere un guard.

---

## 8. Métricas de éxito

- **Cero** lugares del camino de autorización que lean `profiles.role` singular:
  la columna deja de existir.
- Un usuario desactivado recibe 403 en **todos** los handlers de escritura, y
  cero filas afectadas en cualquier intento por RLS.
- La suite completa en verde, incluidos los tests nuevos de integración por cada
  policy tocada.

---

## 9. Riesgos conocidos

- **R-1 — Se toca la puerta de casi todas las policies a la vez.**
  `current_user_role()` la usan siete policies en cinco migrations. Cambiarla
  altera de golpe el comportamiento de todo lo que la usa, incluida la lectura
  del calendario. **Mitigación:** una migration que recrea explícitamente cada
  policy afectada, con un test de integración por policy que lee la fila de
  vuelta, y la lista completa en el plan para que no quede ninguna al azar.

- **R-2 — La RLS falla en silencio.** Un `update` que una policy filtra devuelve
  `error: null` y afecta cero filas. Un test que mire el código de error no
  distingue "funcionó" de "lo bloqueó la policy" — que son justo los dos mundos
  que hay que separar. Es la lección de `004` T4.2 y de ADR 0010.
  **Mitigación:** todo test de esta feature lee las filas de vuelta con
  `service_role`.

- **R-3 — La migration es incompatible con el código deployado.** El proyecto de
  Supabase que sirve el deploy es el mismo que el de desarrollo, y esta migration
  **borra `profiles.role`**, que es la columna que lee el código en producción.
  Entre `db:push` y el deploy de Vercel hay una ventana en que el sitio está
  roto. **Mitigación:** hoy la app está publicada pero **sin usuarios**, así que
  la ventana no le cuesta a nadie; se hace `db:push` y push a `main` seguidos, en
  ese orden. Si hubiera usuarios, esto exigiría una migración en dos fases
  (agregar `roles`, convivir, y borrar `role` después), que es lo que hay que
  hacer la próxima vez.

- **R-4 — El desvío silencioso de `active` en el otro sentido.** Sumar `and
active` a la función de pertenencia deja afuera a un usuario desactivado de
  **todo**, incluida su propia fila de `profiles` si se hiciera mal. Sin poder
  leerse a sí mismo, `/pending-access` no puede decirle nada y queda rebotando.
  **Mitigación:** `profiles: self read` es `auth.uid() = id` y **no pasa por la
  función de roles**; AC-3.4 lo fija como criterio y un test lo cubre.

- **R-5 — `profiles: team directory read` no puede filtrar por `active`.** El
  calendario muestra el nombre del dev asignado en cada bloque, para cualquier
  viewer. Si desactivar a alguien lo saca del directorio, sus reservas viejas
  pierden el nombre — el bug exacto que arregló `…0005`. **Mitigación:** esa
  policy pasa a "tiene al menos un rol" y **no** suma `active`; AC-3.5 lo fija.

---

## 10. Notas

- **Lo que esta feature no arregla y conviene no confundir:** el admin sigue sin
  poder aprobar por otro (ADR 0009, y está bien), la prioridad sigue jugando solo
  al crear (R-2 de `006`), y un proyecto desactivado sigue aceptando reservas
  (D-08).
- **Q-Q1 y Q-Q2 estrenan prefijo `Q-Q`** para no repetir el choque de rótulos que
  se corrigió el 2026-09-07 — `Q-N` y `Q-O` ya están tomados.
