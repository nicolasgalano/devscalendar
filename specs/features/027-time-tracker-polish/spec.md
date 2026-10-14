# Spec — Time tracker: polish + start del cronómetro

- **ID:** 027-time-tracker-polish
- **Estado:** draft
- **Referencias:** `016-time-tracking` (feature original: `/my-time`, `active_timers`, endpoints `/api/time-entries/timer/{start,stop}`). `021-time-tracker-tasks-and-export` (rename UI Actividades → Tareas).

---

## 1. Objetivo

Resolver tres bugs cosméticos del dialog "Cargar tiempo" (`<TimeEntryDialog>`) y conectar el botón "Iniciar cronómetro" que `016` dejó deshabilitado (`disabled title="Próximamente"`) a los endpoints `timer/start` + `timer/stop` que ya existen desde esa feature.

El pedido vino del equipo (Emiliano, 2026-10-14) con un screenshot que muestra los tres bugs juntos y el reporte del botón que no funciona. Son tres fixes chicos + una feature de implementación que cierra lo que `016` dejó anotado al pie del archivo (`weekly-grid-view.tsx:236`: *"El start del cronómetro también podría vivir acá, pero por ahora el user arranca desde el ticket o desde un botón futuro"*).

---

## 2. Contexto

El time tracker (`/my-time`) tiene uso diario del equipo. Los bugs cosméticos no bloquean pero generan ruido visual que **molesta** cada vez que el usuario carga tiempo, y el botón "Iniciar cronómetro" visible pero deshabilitado **confunde** — el tooltip "Próximamente" solo se ve en hover, así que la primera lectura es "está roto".

El cronómetro como funcionalidad **ya existe** en la base: la tabla `active_timers` persiste un timer vivo por usuario (`016` AC-5), y los endpoints `/api/time-entries/timer/start` + `/api/time-entries/timer/stop` convierten ese timer en una `time_entry` cerrada. Lo único que falta es el botón UI que invoque esos endpoints y una pill flotante o indicador que muestre el timer corriendo. El `<TimerPill>` de `016` (`src/components/timer-pill.tsx`) ya cubre lo segundo — solo falta cablear el start.

---

## 3. User stories

- **US-1 · Buscar en el dropdown de proyecto** — Como alguien que carga tiempo y tiene varios proyectos a la mano (10+ activos), quiero poder tipear parte del nombre del proyecto para filtrarlo en el selector, sin tener que scrollear la lista entera.
- **US-2 · Un solo botón de cerrar en el dialog** — Como usuario que abre "Cargar tiempo", quiero ver una sola X para cerrar, no dos superpuestas que confunden sobre cuál es la "real".
- **US-3 · El placeholder del selector de ticket se lee** — Como usuario que todavía no eligió ticket (porque es opcional), quiero ver "Elegí un ticket" o "Sin ticket" en el selector cerrado, no el string literal `__none__` que es parte del código interno.
- **US-4 · Arrancar un cronómetro desde `/my-time`** — Como developer que está arrancando una tarea de la que no sé cuánto tiempo me va a llevar, quiero clickear "Iniciar cronómetro" en el toolbar de `/my-time`, elegir proyecto + tarea + ticket, y que empiece a correr. Después, al terminar, desde el `<TimerPill>` del header lo paro y queda guardado como una `time_entry` cerrada.

---

## 4. Acceptance criteria

### US-1 · buscador en dropdown de proyecto

- **AC-1.1** — Given abro el dialog "Cargar tiempo" y toco el selector de proyecto, when el popover abre, then en la parte superior aparece un campo de búsqueda con placeholder "Buscar proyecto…".
- **AC-1.2** — Given tipeo "and" en el buscador, when el filtro corre, then la lista muestra solo proyectos cuyo **nombre o cliente** matcheen "and" (case-insensitive, substring). El resto queda oculto.
- **AC-1.3** — Given el filtro no deja proyectos, when la lista queda vacía, then aparece un hint "No se encontraron proyectos".
- **AC-1.4** — Given el popover se abre, when el foco entra, then el input de búsqueda recibe foco automáticamente y las flechas ↑/↓ navegan por los resultados filtrados.
- **AC-1.5** — Given cierro y reabro el popover, when vuelve a abrir, then el buscador está vacío (no se preserva el filtro entre aperturas).
- **AC-1.6** — Mismo tratamiento aplica al **selector de ticket** (que puede tener listas largas en proyectos activos). El selector de tarea queda tal cual — las listas de tareas por proyecto son chicas.

### US-2 · una sola X

- **AC-2.1** — Given el dialog "Cargar tiempo" se abre, when inspecciono el header, then veo exactamente **una** X para cerrar en la esquina superior derecha.
- **AC-2.2** — Given hago click en esa X, when el handler corre, then el dialog cierra (misma UX que hoy).
- **AC-2.3** — El fix no afecta a otros dialogs — el que trae X duplicada es solo `<TimeEntryDialog>` (ver §6).

### US-3 · placeholder de ticket se lee

- **AC-3.1** — Given el proyecto elegido tiene tickets disponibles, when el ticket todavía no se seleccionó, then el selector cerrado muestra **"Elegí un ticket (opcional)"** o **"Sin ticket"** según corresponda, nunca `__none__`.
- **AC-3.2** — Given cambio de proyecto y el ticket actual deja de ser válido, when el ticket se resetea a null, then el selector vuelve al placeholder legible.
- **AC-3.3** — El `__none__` como valor interno del Select (constante `NO_TICKET = "__none__"`) **puede quedarse como está** si el bug es de rendering del `<SelectValue>`; lo importante es que el usuario nunca lo ve. Si el fix requiere renombrar la constante, también vale.

### US-4 · botón "Iniciar cronómetro" funcional

- **AC-4.1** — Given estoy en `/my-time` viendo mi propia planilla (no la de otro usuario), when el toolbar muestra el botón "Iniciar cronómetro", then el botón está **habilitado** (sin el `disabled` actual).
- **AC-4.2** — Given clickeo "Iniciar cronómetro", when el dialog se abre, then me pide **proyecto + tarea + ticket (opcional)** con los mismos selectores de "Cargar tiempo", pero **sin** los campos de horario (desde/hasta/duración) — el start time lo toma el server al confirmar.
- **AC-4.3** — Given confirmo el start con proyecto + tarea seleccionados, when el POST a `/api/time-entries/timer/start` responde 201, then el dialog cierra y aparece el `<TimerPill>` en el header con el proyecto + tarea elegidos y el contador andando.
- **AC-4.4** — Given el POST falla (ej. ya hay un timer corriendo — AC-5.3 de `016`), when el server responde 409, then el dialog muestra el error inline y no cierra. El usuario debe parar el timer actual antes de iniciar otro.
- **AC-4.5** — Given estoy viendo la planilla de **otro usuario** (admin/PM mirando a un dev), when el toolbar renderiza, then el botón "Iniciar cronómetro" **queda deshabilitado** (misma regla que "Cargar tiempo" hoy — `isViewingOther`). Nadie inicia timers por otro.
- **AC-4.6** — Given el timer está corriendo, when el usuario cierra la pestaña del browser y la vuelve a abrir, then el `<TimerPill>` del header lo levanta de `active_timers` y sigue mostrando el contador (comportamiento ya existente desde `016`; esta feature solo lo expone).
- **AC-4.7** — Given el `<TimerPill>` dispara el stop, when el POST a `/api/time-entries/timer/stop` responde 200, then la pill desaparece y se refresca la planilla para mostrar la `time_entry` recién cerrada. (Comportamiento ya existente; se mantiene).

---

## 5. Alcance

### Dentro

- **Buscador en el selector de proyecto y de ticket** del dialog "Cargar tiempo" + del dialog de "Iniciar cronómetro" nuevo. Combobox tipo shadcn (el proyecto ya usa Base UI; vale cmdk o un Combobox custom al estilo del mention popover de `022`). Scope limitado a estos dos selectores — el de tarea no se toca (lista corta).
- **Fix de la X duplicada**: eliminar el `<button XIcon>` manual en el header del dialog o pasarle a shadcn `showCloseButton={false}` al `<DialogContent>`. Mantener una sola. Decidir cuál en el plan según cuál conserve mejor accesibilidad.
- **Fix del `__none__` visible**: diagnosticar por qué el `<SelectValue placeholder=...>` no cae al placeholder cuando `value === NO_TICKET` y `display === undefined`. Posibles causas: bug del preset Nova de shadcn, `display` que no es exactamente `undefined`, o el `SelectValue` interpretando "hay valor seleccionado" por `value !== ""`. Fix mínimo que lo cierre.
- **Botón "Iniciar cronómetro" funcional**: eliminar el `disabled` + `title="Próximamente"` de `weekly-grid-view.tsx:238`; conectar a un nuevo dialog "Iniciar cronómetro" (puede ser un modo del `<TimeEntryDialog>` existente — ver plan) con selectores de proyecto/tarea/ticket y sin campos de horario.
- Reusar los endpoints `/api/time-entries/timer/start` y `/api/time-entries/timer/stop` **sin cambios** (ya aceptan `project_id`, `activity_id`, `ticket_id`).
- Reusar el `<TimerPill>` existente **sin cambios** para la UI del timer corriendo.
- Tests unit: hook/helper del buscador (filtro case-insensitive, sin match → mensaje), decisión de qué X dejar.

### Fuera (explícito)

- **Reemplazar `active_timers` por otro mecanismo.** La infra de `016` sigue tal cual: una fila por user con `started_at` + metadata.
- **Múltiples timers simultáneos.** `016` limita a uno por usuario (unique constraint); esta feature no lo toca.
- **Historial de timers rechazados / abortados.** Fuera.
- **Rediseño del `<TimeEntryDialog>`.** Esta feature cambia dos cosas (X duplicada + placeholder del ticket) y agrega el buscador. El resto queda como está.
- **Timer pausable.** Se puede start o stop; no hay "pausa" temporal. Mismo scope que `016`.
- **Agregar el botón "Iniciar cronómetro" en el header global** (al lado del `<TimerPill>`). Vive solo en `/my-time` como la "Cargar tiempo" actual.
- **Tests de integración de los endpoints `timer/*`.** Ya existen desde `016`; no se duplican acá.

---

## 6. Dependencias y hallazgos

- **016-time-tracking** — tabla `active_timers`, endpoints `timer/start` y `timer/stop`, `<TimerPill>`, `<TimeEntryDialog>`, `<WeeklyGridView>`.
- **021-time-tracker-tasks-and-export** — labels UI "Tarea" en lugar de "Actividad" (nada funcional aún).
- **Hallazgos del code review** (2026-10-14):
  - `src/components/time-entries/weekly-grid-view.tsx:238` — botón `<Button disabled title="Próximamente">` con comentario explícito arriba: *"podría vivir acá, pero por ahora el user arranca desde el ticket o desde un botón futuro"*. Esta feature **es** ese botón futuro.
  - `src/components/time-entries/time-entry-dialog.tsx:227-234` — `<button>` custom con `<XIcon>` dentro del `<DialogHeader>`. El `<DialogContent>` de shadcn ya trae su propia X al pulsar Esc o click fuera (y visible en el corner por default). **Hay dos X**.
  - `src/components/time-entries/time-entry-dialog.tsx:26-27` — `const NO_TICKET = "__none__"` + `NO_ACTIVITY = "__none__"`. El de actividad renderiza correctamente ("Elegí una tarea") pero el de ticket renderiza `__none__` según el screenshot. Hipótesis: cuando el `<SelectValue>` tiene `value` seteado pero `display === undefined` y el `<SelectItem value="__none__">Sin ticket</SelectItem>` existe en la lista, el Select SÍ lo encuentra y debería renderizar "Sin ticket" — pero el screenshot muestra `__none__`. Requiere debug en el browser para confirmar (posible bug del `<SelectValue>` del preset Nova con children undefined).

---

## 7. Preguntas abiertas

- **Q-1 · Combobox custom o librería (`cmdk`).** El proyecto hoy no usa `cmdk` (shadcn lo recomienda pero no está instalado). **Recomendación por defecto:** evaluar en el plan. Si el combobox mínimo (input de filtro + lista filtrada) sale en 50 líneas, no vale sumar dep. Si se complica (keyboard nav, highlight de match, virtualización), `cmdk` o similar. **No bloquea.**
- **Q-2 · Botón "Iniciar cronómetro" abre un dialog propio o reusa `<TimeEntryDialog>` en modo `start`?** Reusar es tentador pero mete lógica condicional por todos lados (los campos de horario desaparecen, el botón "Cargar" se convierte en "Iniciar"). **Recomendación por defecto:** dialog nuevo `<TimerStartDialog>` chico que reusa los mismos selectores (`<SelectorRow>` + buscador de Q-1). Menos acoplamiento. **No bloquea.**
- **Q-3 · Cuál X dejamos?** El X manual del dialog está estilado con `text-muted-foreground hover:text-foreground`; el X default de shadcn tiene su propio estilo. **Recomendación:** dejar el X default de shadcn (viene con todas las semánticas de a11y y no hay que mantenerlo) y **borrar** el custom. Si pierde algo visual, ajustamos el default. **No bloquea.**
- **Q-4 · ¿Hidratar `active_timers` al cargar `/my-time`?** El `<TimerPill>` ya hidrata al cargar cualquier página — está en el shell del `AppShell`. **No hay que hacer nada acá.**
- **Q-5 · ¿Qué pasa con `__none__` si el bug viene del preset Nova?** Si confirmamos que es bug del preset, el fix puede ser: (a) renombrar la constante a algo que no se vea raro visible (ej. `""` o un uuid-like), o (b) override del `<SelectValue>` para forzar el fallback a placeholder cuando el value matchea NO_TICKET. **Recomendación:** (b) es menos invasivo. **No bloquea** pero decide la implementación.

---

## 8. Métricas de éxito

- **Cero reports** del equipo sobre los tres bugs cosméticos post-deploy.
- **Al menos 1 timer iniciado desde `/my-time`** por el equipo durante la primera semana después del deploy (medible con `select count(*) from time_entries where created_at > deploy_date and started_at is not null`).
- Zero regresiones en la UX del dialog actual: todo lo que funcionaba sigue funcionando (horario manual, selectores, submit).

---

## 9. Riesgos conocidos

- **R-1 · El combobox que reemplaza al Select rompe algo del Base UI** (foco, aria, click outside). **Mitigación:** empezar por el flow del paste de 022 (`<MentionList>` + `cmdk` o similar) que ya resuelve estos problemas; evitar reinventar.
- **R-2 · El bug del `__none__` resulta ser un bug del preset Nova que no podemos fixear sin cambiar el preset o patch upstream.** **Mitigación:** fallback por workaround (cambiar la constante a un string que no se note raro, ej. `null` serializable o un uuid vacío). El objetivo es que el usuario no lo vea, no limpiar la lib.
- **R-3 · Iniciar un timer sin ticket seleccionado deja una entry sin ticket al cerrar.** Esto ya está permitido en `016` (ticket es opcional); no es un riesgo nuevo.
- **R-4 · Dos usuarios con sesión activa en la misma cuenta** (ej. web + mobile) y uno inicia timer, el otro ve el `<TimerPill>` corriendo. **No es un riesgo nuevo** — ya existe desde `016`; nada nuevo que mitigar acá.

---

## 10. Notas

- Esta feature **no requiere migration**. Reusa tablas y endpoints de `016`.
- **No requiere ADR.** Las decisiones son locales (UI).
- Es una feature chica: estimada en 1-2 phases de implementación. Deployable sin dependencias de otras features en curso.
