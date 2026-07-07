# Spec — Calendar UI (day/month/year + grouping + filters)

- **ID:** 003-calendar-ui
- **Estado:** draft
- **Referencias en la spec funcional:** §4 (módulo calendario), §12 (usabilidad "referencia Google Calendar")

---

## 1. Objetivo

Ofrecer la pantalla principal del sistema: un calendario gráfico con vistas día/mes/año, modos de agrupación por dev o por proyecto, y filtros combinables. Es el corazón de la usabilidad y el requisito de UX más alto del MVP.

---

## 2. Contexto

Es la pantalla donde los PMs pasan la mayor parte del tiempo. La spec pide explícitamente que "se sienta tan fluida y clara como Google Calendar" — es un objetivo de UX, no solo funcional.

---

## 3. User stories

- **US-1** — Como PM/Dev, quiero navegar entre vistas Año → Mes → Día con un click, para localizar rápido el momento que me interesa.
- **US-2** — Como PM, quiero ver la ocupación de un día con bloques posicionados por franja horaria, para entender de un vistazo la carga.
- **US-3** — Como PM, quiero alternar entre "agrupar por dev" y "agrupar por proyecto", para responder distintas preguntas ("¿quién está libre?" vs "¿quiénes trabajan en X?").
- **US-4** — Como PM, quiero filtrar el calendario por cliente, proyecto, dev, PM, estado y prioridad, y combinar filtros, para acotar la vista.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given la vista Año, when se clickea un mes, then se abre la vista Mes de ese mes.
- **AC-1.2** — Given la vista Mes, when se clickea un día, then se abre la vista Día de ese día.
- **AC-1.3** — En cualquier vista hay un control para volver al nivel superior sin perder el filtro activo.

### US-2

- **AC-2.1** — Given la vista Día, when hay reservas, then se muestran como bloques posicionados por hora de inicio y con altura proporcional a la duración.
- **AC-2.2** — Given dos reservas de devs distintos superpuestas, when se renderiza el día, then se muestran en paralelo (columnas), no encimadas.
- **AC-2.3** — Given una reserva prioritaria, when se renderiza, then se distingue visualmente (borde/ícono) de las comunes.

### US-3

- **AC-3.1** — Given la vista Día en modo "por dev", when hay 5 devs con reservas ese día, then se muestran 5 columnas con las reservas de cada uno.
- **AC-3.2** — Given la vista Día en modo "por proyecto", when hay 3 proyectos activos ese día, then se muestran 3 columnas con las reservas de cada proyecto.

### US-4

- **AC-4.1** — Given filtros activos, when se navega entre vistas o se cambia el rango, then los filtros persisten.
- **AC-4.2** — Given filtros combinados (ej. cliente X + estado pending), when se aplican, then el resultado se refleja en <500ms para rangos de hasta 3 meses con <500 bookings.

---

## 5. Alcance

### Dentro

- Vistas día / mes / año.
- Modos de agrupación por dev y por proyecto.
- Filtros combinables: cliente, proyecto, dev, PM, estado, prioridad.
- Carga por rango de fechas (no cargar toda la base al iniciar).

### Fuera (explícito)

- Modo combinado "por dev × por proyecto" (matriz) — puede quedar para Fase 2 (ver §4.3 spec).
- Drag & drop para mover bloques — se maneja en feature 004 (bookings CRUD).
- Vista Semana — no está en la spec funcional; confirmar si se agrega.

---

## 6. Dependencias

- **001-auth-and-permissions** (RLS decide qué se ve).
- **002-entities-admin** (necesita clientes/proyectos/devs para filtrar).
- **004-bookings** (la creación/edición de bloques ocurre desde acá pero se especifica en 004).

---

## 7. Preguntas abiertas

- **Q-5** (de spec §11) — Determina si el dev ve el calendario global o solo el propio. **Impacta:** el default de filtros y la lógica de RLS del query.
- **Q-10** (de spec §11) — Multi-timezone: si los equipos son distribuidos, ¿el calendario se muestra en la TZ del viewer o en una TZ fija del proyecto? **Recomendación por defecto:** TZ del viewer, con badge indicando la del dev asignado si difiere. **Bloquea:** almacenamiento de fechas (siempre en UTC en DB, sí).
- **Q-C** — ¿Se necesita vista Semana? La spec funcional no la lista pero es el default de Google Calendar. **Recomendación por defecto:** no en MVP; agregar en Fase 2 si el cliente la pide.
- **Q-D** — Elección de librería de calendario (FullCalendar, react-big-calendar, Schedule-X, custom). **Recomendación por defecto:** evaluar Schedule-X o custom sobre CSS grid. Documentar en ADR.

---

## 8. Métricas de éxito

- p95 de carga inicial del calendario Mes con 200 bookings < 800ms.
- Tasa de rebote de la pantalla calendario < 5% (mide fluidez percibida).
