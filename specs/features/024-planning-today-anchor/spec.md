# Spec — Planning: la semana de hoy queda como la última de las 4 visibles

- **ID:** 024-planning-today-anchor
- **Estado:** draft
- **Referencias:** `003-calendar-ui` (grilla, filtros, estado en URL, botón "Hoy"). `011-planning-view` (vista "Planning" de 4 semanas ancladas al lunes de `date`; helper `viewBounds` en `src/lib/calendar/range.ts:183-190`; botón "Hoy" en `src/components/calendar/calendar-toolbar.tsx:59-63`).

---

## 1. Objetivo

Cambiar el punto de anclaje de la vista **Planning** para que, al pararse "en hoy" (botón "Hoy" o navegación sin fecha en la URL), la **semana de hoy quede como la ÚLTIMA (cuarta) de las 4 semanas visibles**, no como la primera.

Hoy la vista arranca en `mondayOf(today)` y muestra hoy + 3 semanas al futuro. El usuario quiere el opuesto: **3 semanas atrás + la semana de hoy**. La motivación es alinear la vista con cómo se lee un reporte de carga: lo pasado sirve de referencia (qué se hizo, cómo quedó cada dev), y la semana actual es "lo próximo que hay que ajustar".

**No cambia** el paso de navegación (▶ / ◀ siguen moviendo 4 semanas), ni el ancho de la ventana (siguen siendo 4 semanas), ni el resto de vistas (Day, Month, Year no se tocan). Solo cambia **la fecha de inicio del rango visible** cuando la fecha activa es "hoy".

**Fuera del alcance (a propósito):**

- **Cambio de ancho de la ventana.** Sigue en 4 semanas.
- **Aplicar la misma regla a Day / Month / Year.** Confirmado en la clarificación previa: solo Planning.
- **Cambiar el paso de navegación** (avanzar/retroceder 4 semanas sigue moviendo 4 semanas — no 1 semana ni 3).
- **Cambiar la agrupación / filtros / URL schema** de la vista. El único cambio es de cómputo del rango cuando `date == today`.
- **Persistir preferencias de anclaje por-usuario** ("mostrar hoy en la primera / segunda / cuarta fila"). Un solo comportamiento hardcoded — que sea el mejor para el uso actual. Preferencias son fase 2.
- **Marcar visualmente cuál fila es "esta semana".** Ya se resuelve con el highlight de "hoy" que pinta la celda del día en curso (Day/Month lo hacen; hay que verificar Planning). Si falta, se hereda al Plan pero no forma parte de esta feature.

---

## 2. Contexto

La vista Planning de `011` renderiza una grilla `cliente > proyecto > dev × 28 días` (4 semanas). El ancla es el lunes de la semana de `date` (`viewBounds` en `range.ts:187`). El botón "Hoy" del toolbar (`calendar-toolbar.tsx:59`) hace `href={calendarHref(params, { date: today })}` — pasa **la fecha de hoy tal cual**, sin transformación. Al llegar a `viewBounds`, `mondayOf(today)` empuja el inicio al lunes de esta semana → **hoy queda como la primera fila**, y las 3 filas siguientes son futuras.

**El problema con "hoy primero".** En Planning se ven picos de carga a lo largo de 4 semanas para decidir dónde meter trabajo nuevo. Con hoy como primera fila, las 3 filas futuras son las candidatas a mover — pero lo pasado (que sirve de contexto para decidir) no está visible. El PM que dice "la semana pasada le puse mucho a Fulana, esta semana bajarla" tiene que navegar una vez atrás para verlo. Con **hoy como cuarta fila**, esa historia aparece automáticamente — 3 semanas de pasado inmediato + la semana en curso. El futuro se ve pidiéndolo (una navegación adelante).

**Por qué "hoy" (contiene la fecha actual) y no "cualquier fecha".** Si el usuario navega a una fecha específica (`?date=2026-10-15`), lo que quiere es ver ese contexto, no aplicar reglas mágicas de anclaje. La regla nueva **solo aplica cuando la fecha activa es la fecha de hoy** (típicamente porque acaba de clickear "Hoy" o entró sin `?date`). El resto navega como siempre: `?date=X` en Planning → `[mondayOf(X), +28 días)`.

**Alternativa descartada: cambiar el ancho a 4 semanas ancladas siempre a "última = hoy" con navegación en pasos de 1 semana.** Rompe la simetría con el resto de vistas (Day = 1 día, Month = 1 mes, Planning = 4 semanas), y el paso de navegación de 1 semana es un cambio de UX mayor que nadie pidió. Mantener "4 semanas por página" y cambiar solo el offset de la de hoy es el mínimo cambio que resuelve el pedido.

**Alternativa descartada: agregar `?anchor=last-week` opcional a la URL.** Añade complejidad conceptual (dos formas de decir lo mismo). Si el default es "hoy = cuarta fila", el que quiera "hoy = primera" navega con `date=today` interpretado con el anclaje que ya existe — pero no existe forma de decir eso desde la URL sin sumar parámetro. **Se acepta perder el anclaje viejo** — no había pedido explícito para conservarlo. Si aparece, se piensa entonces.

---

## 3. User stories

- **US-1 · Ver la semana en curso con contexto pasado** — Como PM planificador, quiero abrir la vista Planning y ver por default las 3 semanas anteriores y la semana en curso (esta semana como la última fila), para entender el contexto reciente al decidir dónde meter carga.
- **US-2 · "Hoy" me lleva a esa vista** — Como PM en cualquier fecha lejana de Planning, al clickear "Hoy", quiero volver al mismo layout de US-1 (3 pasadas + esta semana).
- **US-3 · Navegar a otras fechas funciona igual** — Como PM que navega con ▶ / ◀ o edita `?date=` en la URL a una fecha específica, quiero ver 4 semanas ancladas al lunes de esa fecha (comportamiento actual), sin que la nueva regla me sorprenda.
- **US-4 · Consistencia con Day/Month/Year** — Como usuario del calendario, quiero que las vistas Day, Month y Year sigan comportándose como hoy — "Hoy" me lleva a hoy sin trucos.

---

## 4. Acceptance criteria

- **AC-1** — Given estoy en cualquier vista, when clickeo "Hoy" y la vista es **Planning**, then la URL termina en `?view=planning&date=<hoy>` (sin cambios respecto al comportamiento actual — el link del botón sigue igual), y **la grilla renderiza el rango `[mondayOf(hoy) - 21 días, mondayOf(hoy) + 7 días)`** — es decir, la semana de hoy es la **cuarta** de las 4 visibles.
- **AC-2** — Given navego a `/calendar?view=planning` **sin `date`** (default), when parseCalendarParams cae al default `date=hoy`, then la grilla renderiza el mismo rango de AC-1.
- **AC-3** — Given navego a `/calendar?view=planning&date=2026-11-05` con una fecha **distinta de hoy** (pasada o futura), when se calcula el rango, then el ancla es `mondayOf(2026-11-05)` y la grilla muestra **4 semanas empezando ahí** (comportamiento actual, sin cambios). La regla nueva **no** aplica.
- **AC-4** — Given navego a `/calendar?view=planning&date=<hoy>` explícitamente (URL escrita a mano o compartida), when se calcula el rango, then aplica **la nueva regla** (rango `[mondayOf(hoy) - 21, mondayOf(hoy) + 7)`). Es coherente con AC-1: la regla dispara cuando `date == hoy en la zona horaria del viewer`, sin importar cómo se llegó a esa URL.
- **AC-5** — Given clickeo "Hoy" y la vista es **Day / Month / Year**, when navego, then el comportamiento es **idéntico al actual** — sin cambios. Solo Planning aplica la regla.
- **AC-6** — Given estoy en Planning con `date=hoy` (regla aplicada), when clickeo "▶" (siguiente), then el nuevo `date` se calcula igual que hoy (`shiftDate('planning', hoy, +1)` = `addDays(mondayOf(hoy), 28)` — el helper actual), y la grilla muestra las 4 semanas que **siguen a la actual**. La regla se pierde en cuanto navego — solo aplica cuando la fecha activa es hoy.
- **AC-7** — Given estoy en Planning con `date=hoy` (regla aplicada), when clickeo "◀" (anterior), then el nuevo `date` es `shiftDate('planning', hoy, -1)` = 4 semanas atrás, y la grilla muestra 4 semanas empezando 8 semanas atrás. La regla no se retroaplica al retroceder.
- **AC-8** — Given aplicó la regla nueva y hoy es **domingo**, when se renderiza, then el rango arranca correctamente en el **lunes** 3 semanas atrás y termina en el **domingo** de esta semana (día de hoy = último día de la 4ª fila). `mondayOf(sunday)` sigue devolviendo el lunes de la misma semana ISO.
- **AC-9** — Given aplicó la regla nueva y hoy es **lunes**, when se renderiza, then la semana de hoy es la 4ª fila y el día de hoy es el **primer** día (lunes) de esa fila. No hay caso borde raro con `mondayOf` cuando hoy es lunes.
- **AC-10** — Given corren los tests de unit del `viewBounds`, when se agregan los casos de la regla nueva, then **los casos existentes siguen pasando** (Day, Month, Year, Planning con `date != hoy`). Los nuevos cubren AC-1/2/3/4/8/9.
- **AC-11** — Given la URL compartida por email o pinneada al bookmark (`/calendar?view=planning&date=2026-09-21`), when la abre otro usuario en un **día distinto** (ej.: 2026-09-22), then la URL activa la regla o no según **la fecha del viewer**, no la fecha original — la URL guarda un `date` explícito y ese día ya no es "hoy" para el viewer, así que **no aplica la regla** (comportamiento AC-3). **Cuidado:** esto tiene una consecuencia práctica — un link compartido de "hoy" cambia de layout de un día a otro. Se acepta; es el mismo comportamiento que hoy tienen las vistas Day/Month/Year: `?date=X` es siempre `X`, y "Hoy" es siempre hoy.

---

## 5. Alcance

**Dentro:**

- **`viewBounds`** (`src/lib/calendar/range.ts:171-191`): la rama `case "planning"` recibe un parámetro nuevo `today` (opcional, `YYYY-MM-DD` en la TZ del viewer) — o un flag booleano derivado en el call site. Si `isoDate === today`, `start = addDays(mondayOf(isoDate), -21)`. Si no, sigue como hoy (`mondayOf(isoDate)`).
- **Call sites de `viewBounds`** (por lo menos `resolveRange` en `range.ts:198` y cualquier consumidor que lo use directamente): se pasan `today` cuando corresponda, o se computa `today` en el mismo lugar donde ya se computa (typically el server component de `/calendar`). El plan hace el inventario exacto.
- **Tests unit** en `tests/unit/lib/calendar/range.spec.ts` (o el archivo equivalente): sumar los casos de AC-1/3/8/9. No hace falta test para AC-5 (Day/Month/Year se saltean solo — solo el `case "planning"` cambia).
- **Sin migration.** Es un cambio de cómputo puro en TS.
- **Sin cambios de UI directa.** El botón "Hoy" del `calendar-toolbar.tsx` sigue linkeando a `date=today`. La grilla `<PlanningView>` sigue recibiendo `days` — solo cambia el arreglo de días que le llega.

**Fuera:**

- **Cambios de estilo visual.** Si la fila de hoy debería tener un highlight (por ser la última), es una feature aparte (a incorporar en `011` si aún no lo tiene, no acá).
- **Preferencias por-usuario del anclaje** ("prefiero hoy en la primera fila"). Sin pedido, sin implementación.
- **Cambio de paso de navegación.** ▶ y ◀ siguen moviendo 4 semanas.
- **Extender la regla a Day/Month/Year.** Explicado en §1.
- **Refactor de `viewBounds` a algo más pluggable** ("una función por vista con su config"). Es sobreingeniería para un cambio de 4 líneas.
- **Test de UI (E2E)** que valide el layout. Un unit test del helper cubre la lógica; E2E de una regla de fecha es costo alto sin valor incremental.

---

## 6. Preguntas abiertas

- **Q-1 · ¿Comparar `isoDate === today` como string, o parsear y comparar como fecha?** **Preferencia inicial: string.** Ambos son `YYYY-MM-DD` en la misma TZ (la del viewer, ya resuelta antes de llegar a `viewBounds`). Comparación por string es determinista y no depende de zonas horarias intermedias. `todayInTimeZone(tz)` ya devuelve el formato correcto.
- **Q-2 · ¿La firma de `viewBounds` recibe `today` como argumento nuevo o se computa adentro?** **Preferencia inicial: como argumento**. `viewBounds` es una función pura hoy, y sumarle una lectura de reloj adentro la vuelve dependiente del entorno (rompe tests). El call site pasa `today` que ya conoce.
- **Q-3 · ¿La regla se documenta en el `comment` de la función `viewBounds` o en un JSDoc del case Planning?** **Preferencia inicial: JSDoc en el case Planning con la razón** (el "por qué" del §2). El que llegue a mantener el archivo tiene que entender que el default es "hoy = última fila" **a propósito**, no un bug.
- **Q-4 · ¿Qué pasa en la vista con filtro `?date=hoy` compartido por link y abierto al día siguiente?** Cubierto por AC-11. **Preferencia inicial: aceptar** — el layout cambia de un día al otro. Si alguien pinnea el link de "hoy" y lo revisita, lo que ve el segundo día es "hoy del segundo día" (porque el server calcula `today` en el momento de la request). Correcto por diseño.

---

## 7. Riesgos

- **R-1 · Confusión visual "por qué la vista arranca 3 semanas atrás"** — Un usuario que no lee esta spec puede pensar que el "Hoy" está roto ("¿por qué no me lleva a esta semana como primera?"). **Mitigación:** highlight de la semana/día de hoy (heredado de `011` o a sumar), tooltip en el botón "Hoy" ("Ir a esta semana"), y — si se justifica — un pequeño label "Esta semana" en la 4ª fila del header. Baja prioridad; se decide en el plan.
- **R-2 · Regla implícita que no se descubre al leer el código** — El `case "planning"` de `viewBounds` gana una rama con un `if (isoDate === today)`. Sin comentario, alguien la borra creyendo que es un bug. **Mitigación:** JSDoc en el case (Q-3), y un test unit dedicado al caso "hoy" que titula "PLANNING con date=hoy ancla la semana actual a la última fila" — cualquier refactor que rompa la regla rompe el test.
- **R-3 · Ambigüedad en el link compartido** — Ver AC-11 y Q-4. Un link a `?date=2026-09-21` no aplica la regla si mañana lo abre otra persona. **Mitigación:** aceptado por diseño; documentar en el AC.
- **R-4 · Ancho de la ventana no coincide con el paso de navegación** — Si un día alguien decide "4 semanas de ancho, paso de 1 semana", este cambio queda desalineado. **Mitigación:** aceptar. La spec de ese cambio, si aparece, resuelve el layout completo.
- **R-5 · Perf: `viewBounds` gana un parámetro y su llamada se propaga a varios archivos** — Cambio de firma; puede haber ~5 call sites. **Mitigación:** `today` es opcional (default `undefined` = comportamiento actual); Planning es el único case que lo consume. Los call sites que no pasan `today` no rompen (Day/Month/Year no lo usan).

---

## 8. Dependencias

- **011-planning-view** — dueña de la vista Planning, del `case "planning"` en `viewBounds` (`range.ts:183-190`), y de la grilla `<PlanningView>`. Esta feature cambia el cómputo del rango — el resto se hereda tal cual.
- **003-calendar-ui** — dueña del toolbar (`calendar-toolbar.tsx`), del botón "Hoy", del schema de URL (`validation/calendar.ts`). **No** se toca — el botón sigue linkeando a `date=today`, y `parseCalendarParams` sigue cayendo a `today` cuando falta `date`. El cambio es purely computacional en `viewBounds`, aguas abajo.

---

## 9. Compatibilidad con features futuras

- **Preferencia por-usuario del anclaje.** Sumar `profiles.planning_anchor text default 'today-last'` con valores `'today-first' | 'today-middle' | 'today-last'`. El call site lee la preferencia y pasa el offset a `viewBounds`. Aditivo.
- **Cambio del ancho de la ventana** (a 6 semanas, a 8 semanas). Se cambia el `28` de `range.ts:188` por una constante y el `-21` de la nueva regla se recalcula (`ancho - 7`). Sin cambios estructurales.
- **Botón "Ir a esta semana" separado del "Hoy"** (para vistas donde hoy no es una semana, como Month). No aplica a Planning; se resuelve en cada vista.
- **Marcado visual de "esta semana" en la grilla** (fondo tenue en la 4ª fila cuando aplica la regla). Es un cambio de `<PlanningView>` que puede recibir `todayWeekIndex` como prop y colorear. Feature de UX pura, no de datos.
