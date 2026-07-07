# Spec — Jira integration

- **ID:** 008-jira-integration
- **Estado:** draft
- **Referencias en la spec funcional:** §8.2 (Jira)

---

## 1. Objetivo

Permitir asociar un ticket de Jira a una reserva, con búsqueda de tickets desde el formulario de creación y mostrando código + estado del ticket en el bloque del calendario.

---

## 2. Contexto

Da trazabilidad concreta al tiempo planificado: cada bloque no es "trabajo genérico" sino "trabajo sobre este ticket específico". Es también la base para el opcional de reportar tiempo planificado en Jira (fuera del MVP inicial, pero deseable).

---

## 3. User stories

- **US-1** — Como PM, quiero buscar y seleccionar un ticket de Jira al crear una reserva, para asociar el bloque al trabajo concreto.
- **US-2** — Como Dev o PM viendo el calendario, quiero ver el código y estado del ticket sobre el bloque, para tener contexto sin abrir Jira.
- **US-3** — Como Admin, quiero configurar la integración por proyecto (URL de Jira, credenciales, mapeo de proyecto Jira), para que cada proyecto use su propia instancia.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un PM crea una reserva sobre un proyecto configurado con Jira, when abre el selector de tickets, then puede buscar por código o texto entre los tickets del proyecto Jira mapeado.
- **AC-1.2** — Given un ticket es seleccionado, when se guarda la reserva, then queda persistido el `external_ref` = `{ system: 'jira', key: 'ABC-123' }`.

### US-2

- **AC-2.1** — Given una reserva con ticket Jira asociado, when se renderiza en el calendario, then muestra el key (ABC-123) y (si hay caché disponible) el estado actual.
- **AC-2.2** — Given el estado del ticket cambia en Jira, when se refresca la vista, then el badge de estado refleja el estado nuevo (con caché ≤ 5 min).

### US-3

- **AC-3.1** — Given un Admin, when configura la integración Jira para un proyecto, then puede indicar: base URL, credenciales (o cuenta OAuth), y el project key de Jira.
- **AC-3.2** — Given credenciales inválidas, when se prueba la conexión, then el sistema muestra un error claro y no guarda la config rota.

---

## 5. Alcance

### Dentro

- Búsqueda de tickets desde el form de reserva (proxy server-side hacia Jira).
- Almacenamiento de `external_ref` en la reserva.
- Caché corto (≤ 5 min) del estado de ticket para no golpear Jira en cada render.
- Config por proyecto.

### Fuera (explícito)

- Auto-registrar tiempo planificado o cambiar estado del ticket en Jira — pedido "opcional" en la spec; se defiere.
- Webhooks de Jira hacia DevsCalendar (para invalidación de caché en tiempo real) — Fase 2.
- Import bidireccional de proyectos Jira como proyectos de DevsCalendar.

---

## 6. Dependencias

- **004-bookings** (para tener el campo `external_ref`).
- **002-entities-admin** (para la config por proyecto).

---

## 7. Preguntas abiertas

- **Q-4** (de spec §11) — ¿Jira y Slack alternativos o ambos por proyecto? **Recomendación por defecto:** ambos configurables por proyecto. **Bloquea:** modelo de config de proyecto.
- **Q-J** — Auth con Jira: OAuth por usuario o app-level con API token compartido. **Recomendación por defecto:** API token por proyecto (más simple para MVP); OAuth per-user en Fase 2 si hace falta.

---

## 8. Métricas de éxito

- Búsqueda de tickets p95 < 500ms.
- ≥ 90% de reservas creadas tienen ticket asociado (indicador de adopción; opcional en la UI, no obligatorio).
