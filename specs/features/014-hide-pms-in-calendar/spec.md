# Spec — PMs fuera del calendario por default

- **ID:** 014-hide-pms-in-calendar
- **Estado:** draft
- **Referencias en la spec funcional:** §4 (módulo calendario), §11 (roles)

---

## 1. Objetivo

Los PMs no deberían aparecer en el calendario cuando alguien lo abre para ver la carga del equipo. Un toggle en el panel de filtros los trae de vuelta cuando hace falta.

---

## 2. Contexto

Con el import de agosto 2026 el calendario dejó de tener solo devs: Brenda (PM), Lucía (PM) y Pedro (PM) tienen todas sus horas cargadas, y aparecen mezcladas con las de los devs cuando alguien abre `/calendar` para responder "¿quién está libre?" o "¿quién está sobrecargado?". El calendario es un panorama del equipo de **desarrollo**, y esas dos preguntas no las contesta si arriba de todo hay una fila de una PM con 8 h de reuniones.

Este proyecto va a terminar reemplazando a Tracking Time como time tracker del equipo, y el histórico de PMs va a seguir cargándose. Sin este filtro, el calendario se degrada a medida que crece el uso.

---

## 3. User stories

- **US-1** — Como PM/admin, cuando abro el calendario, no quiero ver por default a las personas cuyo único rol es PM, para responder de un vistazo la pregunta que la vista existe para responder.
- **US-2** — Como PM/admin, quiero un toggle en el panel de filtros para **incluir PMs** cuando necesito ver la carga combinada de todo el equipo (por ejemplo, planificar reuniones cross-team).
- **US-3** — Como PM/admin, si un link o bookmark viejo tiene un PM seleccionado explícitamente en el filtro de dev, quiero que ese PM se muestre igual — la selección explícita gana sobre el default.

---

## 4. Acceptance criteria

### US-1 · default oculta a los PMs

- **AC-1.1** — Given un usuario logueado abre `/calendar` sin parámetros, when la vista carga, then los bookings cuyo `dev_id` tenga `roles = {'pm'}` (**PM puro**: solo PM, sin `developer`) **no se muestran**.
- **AC-1.2** — Given el desplegable del filtro "dev", when se abre, then lista **solo profiles con `developer` en `roles`**. Los PM puros no aparecen. (Un profile con `roles = {'pm', 'developer'}` aparece — sigue siendo dev.)
- **AC-1.3** — Given la vista Planning (`?view=planning`), when se renderiza, then las filas cliente > proyecto > **dev** se computan sobre bookings de devs; los PM puros no generan filas. La detección de sobrecarga (`getDevDayLoad`, plan `011` §6) se calcula sobre los mismos devs — la carga de un PM no cuenta como carga del equipo.

### US-2 · toggle "incluir PMs"

- **AC-2.1** — El panel de filtros suma un control **"Incluir PMs"** al lado del filtro "dev". Off por default.
- **AC-2.2** — Given el toggle está activo, when la vista se renderiza, then los bookings de PM puros **se muestran** en todas las vistas (día, mes, año, planning), y el desplegable del filtro "dev" **incluye** a los PMs además de los devs.
- **AC-2.3** — El estado del toggle vive en la URL como `includePms=1`. Ausente = off. **No se escribe el valor default**, siguiendo la convención de `src/lib/calendar/url.ts`.
- **AC-2.4** — Given el toggle está activo y el usuario navega a otra vista o cambia de fecha, when el href se reconstruye, then `includePms=1` se conserva junto con el resto de los filtros (por construcción de `buildCalendarHref`).

### US-3 · selección explícita gana

- **AC-3.1** — Given la URL contiene `devId=<uuid-de-un-PM>` y `includePms` está off, when la vista carga, then los bookings de ese PM **se muestran** — la selección explícita gana sobre el default. El desplegable del filtro sigue mostrando solo devs (AC-1.2), pero el filtro aplicado ya tiene al PM seleccionado y se respeta.
- **AC-3.2** — En el caso de AC-3.1, el panel de filtros muestra el nombre del PM seleccionado con un badge o marca visual que aclare que **normalmente no estaría visible**, para que el usuario entienda por qué solo aparecen las horas de esa persona (detalle visual lo define `plan.md` según `DESIGN.md`).

### Interacciones con lo que ya existe

- **AC-4.1** — El filtro `pmId` (filtrar por qué PM gestiona el proyecto) **no cambia**: sigue filtrando proyectos por su `pm_id`, no por el `dev_id` del booking. Son dos preguntas distintas y esta feature no las toca.
- **AC-4.2** — La capacidad del calendario (`countConsideredDevs`, `plan 003` §6.2) sigue mirando `roles contains 'developer'`. No cambia — ya excluía a los PM puros.
- **AC-4.3** — Las facetas del panel (`facets.ts`) se recomputan considerando el filtro de PMs igual que los demás: si `includePms=0`, las opciones ofrecidas para "proyecto" no bajan a cero porque un PM tenía muchas horas ese mes — se ve el mismo conteo que si esos bookings no existieran.

---

## 5. Alcance

**Dentro:**
- Filtro en las cuatro vistas del calendario (día, mes, año, planning).
- Toggle en el panel de filtros y URL param.
- Desplegable del filtro "dev": esconder PM puros por default.

**Fuera:**
- ABM de `/admin/*`: los PMs siguen siendo visibles ahí como siempre.
- Bandeja `/inbox`: ya es por usuario, no aplica.
- Auditoría / notificaciones: no se tocan.
- Cambios de schema o RLS: ninguno. Es UI + query filter en el server component.

---

## 6. Preguntas abiertas

- **Q-1** — Un profile con `roles = {'pm', 'developer'}` (PM que además programa) — ¿aparece siempre porque tiene 'developer'? **Respondida:** sí, siempre aparece. La definición de "PM a esconder" es **PM puro** (solo 'pm', sin 'developer').
- **Q-2** — Si `includePms=0` y el usuario tiene `devId=<PM>` explícito en la URL, ¿cómo se comunica visualmente esa combinación? **A definir en plan.md** con `DESIGN.md`.
- **Q-3** — ¿El toggle recuerda su estado entre sesiones (localStorage) o siempre nace off? **Nace off**, coherente con el resto de los defaults del calendario (que viven solo en URL).

---

## 7. Riesgos

- **R-1** — La lógica de "PM puro" (roles = ['pm'] exacto vs. `contains 'pm' and not contains 'developer'`) se resuelve en dos lugares (query de bookings y query del dropdown), y las dos tienen que coincidir. Un desajuste hace que un PM aparezca en el dropdown pero no tenga bookings visibles, o al revés. **Mitigación:** un helper único en `@/lib/auth/roles` (`isPmOnly(profile)`) y un test que verifique que ambos consumidores usan el mismo criterio.
- **R-2** — El filtro es transparente para quien no sabe que existe: alguien que ve el calendario y no encuentra a Brenda podría pensar que Brenda no cargó nada. **Mitigación:** el toggle está visible en el panel de filtros, no oculto en un menú.
