# 0007 — Calendario propio sobre CSS grid, en vez de una librería

- **Estado:** accepted
- **Fecha:** 2026-08-06

## Contexto

`003-calendar-ui` es la pantalla principal del producto: vistas día / mes / año, agrupación por desarrollador o por proyecto, y seis filtros combinables. La spec funcional (§12) pide explícitamente que "se sienta tan fluida y clara como Google Calendar", y la spec de la feature dejó la elección de librería como pregunta abierta (Q-D).

La decisión afecta a varias features (`004` agrega drag & drop sobre esta misma grilla, `005` y `006` pintan estados y realocaciones encima), así que amerita ADR.

## Decisión

**Se construye una grilla propia sobre CSS grid.** No se usa FullCalendar, Schedule-X ni react-big-calendar.

## Consecuencias

**Positivas:**

- Control total sobre la densidad, los tokens y la accesibilidad, que es donde este producto se juega la UX. `DESIGN.md` fija franjas de 30 min en 24px, carriles de 160px y una paleta categórica con luminancia pareja; nada de eso sale de la configuración de una librería.
- Lo difícil quedó en funciones puras testeables sin DOM: `range.ts` (rangos y timezone), `layout.ts` (filas de grilla y reparto de solapamientos), `load.ts` (ocupación). Son 63 tests unitarios que corren en 3 segundos sin base de datos.
- Sin dependencia nueva ni licencia. El bundle de `/calendar` agrega 7,3 kB sobre el compartido.
- La grilla es paramétrica en cantidad de carriles, así que agregar la vista Semana (Q-C, fuera del MVP) es una vista nueva sobre las mismas funciones, no un rediseño.

**Negativas:**

- Hay que escribir y mantener el posicionamiento de bloques, el reparto de solapamientos y la navegación entre vistas. Ya apareció el costo: el algoritmo de columnas tuvo que trabajar por *cluster* y no por par, porque contar solapamientos por reserva da anchos inconsistentes dentro de un mismo grupo visual.
- El drag & drop de `004` hay que implementarlo con pointer events sobre esta grilla, en vez de activar una prop.
- La geometría no se puede verificar con tests de HTML: hay un E2E que mide `boundingBox()` en un navegador real para confirmar que un bloque de 4 h mide 192 px y que dos solapadas quedan lado a lado.

## Alternativas consideradas

- **FullCalendar.** El modo "agrupar por desarrollador" es exactamente su *resource timeline*, que está bajo licencia comercial. Pagar una licencia por la mitad de una feature del MVP no se justifica, y su DOM y CSS propios pelean de frente con la escala de densidad de `DESIGN.md`.
- **Schedule-X.** Moderno y prolijo, pero la vista de recursos —los carriles, que son el corazón de US-3— también es del plan pago, con el mismo problema de estilos.
- **react-big-calendar.** Gratis y con `resources` en la vista Día, pero no tiene vista Año (habría que escribirla igual), su CSS es un tema completo que habría que sobrescribir entero, y su modelo de layout no contempla la rampa de densidad de ocupación de la vista Mes.

En los tres casos, la parte que resolvían gratis (posicionar bloques por hora) es la más simple de escribir; la que necesitábamos de verdad (carriles por recurso) era paga o inexistente.
