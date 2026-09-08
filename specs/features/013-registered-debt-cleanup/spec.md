# Spec — Saldar la deuda registrada que queda

- **ID:** 013-registered-debt-cleanup
- **Estado:** ready-to-plan
- **Referencias en la spec funcional:** §3 (roles y permisos), §12 (seguridad)
- **Origen:** el registro de deuda, con OK explícito del usuario del 2026-09-08.
  Salda **D-02** (y con ella F7 de `003`), **D-03**, **D-04**, **D-05** y
  **D-08**, y achica **D-06** a lo que solo puede hacer una persona.

---

## 1. Objetivo

Cerrar las cinco deudas registradas que quedan y que no dependen de un navegador
con una sesión real, dejando **D-06** reducida a su parte irreducible: confirmar
a mano con una cuenta de Google.

No hay funcionalidad nueva. Lo que hay es un agujero de lectura, una mitad de AC
sin implementar, seis vocabularios de base que se filtran a la pantalla, seis
handlers que responden 500 donde va un 400, y un soft delete que no impide
escribir historia nueva sobre lo borrado.

---

## 2. Contexto

Las cinco son de features cerradas y todas estaban anotadas con archivo y línea.
Se agrupan en una sola porque son chicas y porque **dos de ellas comparten
migration** (F7 y D-08 tocan policies), así que separarlas es pagar dos veces el
`db:push`, los tests de integración y la ventana de deploy.

**La que no es cosmética es F7**, la otra mitad de D-02: las policies de `select`
de `clients` y `projects` son `using (true)`. Cualquiera que complete el OAuth de
Google —aunque esté esperando en `/pending-access` sin que nadie lo haya dado de
alta— puede leer por API la lista de clientes y de proyectos de la empresa.
`bookings` y `profiles` ya exigen rol desde `012`; estas dos quedaron atrás.

Que eso sea alcanzable es consecuencia directa de **D-02**: AC-1.3 pedía que un
login sin alta previa **no dejara sesión iniciada**, y lo que se implementó deja
la sesión y manda a `/pending-access`. Es la decisión correcta —sin sesión no se
sabe a quién mostrarle el cartel, ni qué email nombrar— pero nunca se escribió
como desvío, así que el AC y el código dicen cosas distintas y nadie lo sabe.
**Una explica a la otra y por eso se saldan juntas.**

---

## 3. User stories

- **US-1** — Como responsable del producto, quiero que **un usuario sin alta no
  pueda leer la lista de clientes y proyectos**, para que completar un login de
  Google no sea, por sí solo, acceso a información del negocio.
- **US-2** — Como PM, quiero que el desplegable de desarrolladores **me ofrezca
  primero a los míos**, para no buscar entre todo el equipo en el caso común.
- **US-3** — Como Admin, quiero que las pantallas de `/admin/*` **hablen mi
  vocabulario y no el de la base**, para no leer `__none__` ni un uuid donde
  debería decir un nombre.
- **US-4** — Como responsable del producto, quiero que **un proyecto desactivado
  no acepte reservas nuevas**, para que desactivarlo signifique algo.
- **US-5** — Como desarrollador del proyecto, quiero que un body mal formado
  responda **400 y no un 500 con stack trace**, para que la basura de un cliente
  no quede registrada como una falla del servidor.

---

## 4. Acceptance criteria

### US-1 — D-02 y F7

- **AC-1.1** — Given un usuario autenticado **sin rol asignado**, when consulta
  `clients` o `projects` por API, then recibe **cero filas**.
- **AC-1.2** — Given un usuario con rol y activo, when consulta lo mismo, then
  las ve como siempre. El calendario no cambia para nadie que trabaje acá.
- **AC-1.3** — Given un usuario **desactivado**, when consulta lo mismo, then
  recibe cero filas, igual que en `bookings` desde `012`.
- **AC-1.4** — El desvío de AC-1.3 de `001` queda **registrado** en su `spec.md`:
  la sesión sobrevive al login sin alta, a propósito, y `/pending-access` es la
  consecuencia.

### US-2 — D-03

- **AC-2.1** — Given un PM que abre el diálogo de reserva, when se despliega la
  lista de desarrolladores, then aparecen **primero los que lo tienen como PM
  primario**, y después el resto, cada grupo por nombre.
- **AC-2.2** — Given un Admin, when abre el mismo diálogo, then el orden es
  alfabético: no tiene "sus" devs, y un orden que dependa de quién mira sin que
  se note sería peor que ninguno.
- **AC-2.3** — **Ningún desarrollador desaparece de la lista.** Es un orden, no
  un filtro: el AC original dice "candidato natural", no "único candidato".
- **AC-2.4** — La columna **PM primario sale de la tabla** de `/admin/users`: no
  alimenta ninguna decisión y le cuesta ancho a la tabla. Se sigue editando desde
  el diálogo.

### US-3 — D-04

- **AC-3.1** — Given cualquiera de los cuatro `Select` que quedan en `/admin/*`,
  when hay un valor elegido, then el trigger muestra **el texto del item**, nunca
  el valor: ni `__none__`, ni un uuid, ni `normal`.
- **AC-3.2** — Given el desplegable de prioridad, when muestra su valor, then
  dice `Común` o `Prioritario`, que es lo que ya dicen sus opciones.

### US-4 — D-08

- **AC-4.1** — Given un proyecto **desactivado**, when alguien intenta crear una
  reserva sobre él —API o base—, then se rechaza.
- **AC-4.2** — Given ese mismo proyecto desactivado, when su PM **cancela o
  edita** una reserva ya existente, then puede. Desactivar un proyecto no
  congela lo que ya se había comprometido: bloquea historia nueva, no la vieja.

### US-5 — D-05

- **AC-5.1** — Given un `POST` o `PATCH` con body vacío o mal formado a
  cualquiera de los seis handlers de `002`, when se procesa, then responde
  **400**, no 500.

---

## 5. Alcance

### Dentro

- Las policies de `select` de `clients` y `projects` pasan a exigir rol y
  actividad, y el desvío de AC-1.3 se registra.
- `getBookingOptions()` ordena por PM primario; la columna sale de la tabla.
- Los cuatro `<SelectValue>` que quedan resuelven su texto a mano.
- `readJsonBody()` en los seis handlers de `002`.
- Un proyecto desactivado deja de aceptar reservas nuevas.
- **Cobertura E2E que achica D-06:** `/admin/users` y `/admin/projects` con un
  PM, más los 403 de los tres handlers de administración.

### Fuera (explícito)

- **D-06 no se cierra acá.** Lo que queda es la confirmación a mano con una
  sesión real de Google, que ningún test reemplaza porque los E2E plantan la
  cookie de sesión.
- **F5 de `003`** (mantenimiento anual de feriados) no es deuda de código.
- **Sacar la columna `primary_pm_id` de la base.** Se eligió la salida (1) de las
  tres de D-03: orden, no filtro ni borrado.

---

## 6. Dependencias

- **012** mergeada: `has_any_role()` es lo que usan las policies nuevas, y
  `can_manage_booking()` ya está reescrita.

---

## 7. Preguntas abiertas

Ninguna. D-03 la resolvió el usuario el 2026-09-08 eligiendo entre las tres
salidas que su entrada dejaba escritas.

---

## 8. Métricas de éxito

- Cero filas de `clients` o `projects` para un usuario sin rol, verificado
  leyendo de vuelta.
- Cero `<SelectValue>` sin hijos en `/admin/*`.
- Cero `request.json()` directo en `src/app/api/`.

---

## 9. Riesgos conocidos

- **R-1 — F7 cambia permisos de lectura, no cosmética.** Si algo del producto
  dependiera de leer maestros sin rol, se rompe. **Mitigación:** lo único que lee
  `clients` y `projects` sin sesión útil es `/pending-access`, que no los toca; y
  los tests de integración cubren el usuario con rol, el sin rol y el
  desactivado.
- **R-2 — D-08 en el lugar equivocado congela lo existente.** Poner el chequeo en
  `can_manage_booking()` bloquearía también cancelar y editar reservas de un
  proyecto dado de baja, que es exactamente lo que un PM necesita poder hacer
  después de desactivarlo. **Mitigación:** el chequeo va en la policy de
  **insert**, no en la función compartida (AC-4.2, con su test).
- **R-3 — El orden de D-03 depende de quién mira.** Dos PMs ven la misma lista en
  distinto orden, lo que puede confundir en un pantallazo compartido.
  **Mitigación:** el grupo propio se ordena primero pero **nada se oculta**, y el
  admin —que no tiene devs propios— ve el orden alfabético de siempre.
