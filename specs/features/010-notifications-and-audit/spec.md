# Spec — Notifications & audit log

- **ID:** 010-notifications-and-audit
- **Estado:** draft
- **Referencias en la spec funcional:** §7 (auditoría de realocación), §12 (auditoría no funcional), §6/§8.3 (notificaciones)

---

## 1. Objetivo

Proveer la infraestructura transversal para (a) notificar a usuarios por múltiples canales (in-app, Slack, email opcional) sobre eventos relevantes, y (b) auditar toda transición de estado y acción sensible en el sistema.

---

## 2. Contexto

Notificaciones y auditoría son requisitos no funcionales que aparecen en múltiples features. En vez de reimplementarlos en cada feature (approval, priority, etc.), esta feature los consolida en un módulo transversal.

---

## 3. User stories

- **US-1** — Como Dev/PM, quiero ver una bandeja in-app con todas mis notificaciones y marcarlas como leídas, para no perderme nada.
- **US-2** — Como sistema, quiero registrar en `audit_log` toda transición de estado y acción sensible, para poder reconstruir qué pasó cuándo y quién lo hizo.
- **US-3** — Como Admin, quiero poder consultar el `audit_log` filtrado por reserva, usuario o acción, para investigar incidentes.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un evento genera una notificación (ej. reserva creada), when se persiste, then aparece en la bandeja del destinatario sin necesidad de recargar la página (via Supabase Realtime).
- **AC-1.2** — Given una notificación no leída, when el usuario la clickea, then se marca como leída y (si corresponde) se redirige al recurso relacionado (la reserva).
- **AC-1.3** — Cada notificación registra sus canales (in-app, slack, email) y su estado de entrega por canal.

### US-2

- **AC-2.1** — Given una transición de estado de reserva (`create`, `update`, `approve`, `reject`, `cancel`, `displace`), when ocurre, then se persiste un registro en `audit_log` con: actor, acción, reserva_ref, timestamp, y un JSON diff antes/después.
- **AC-2.2** — Given una realocación por prioridad, when ocurre, then se registran **dos** entradas en audit_log: una por el displace de la anterior y otra por la creación de la nueva.
- **AC-2.3** — El audit_log es append-only (no permite update ni delete a nivel de RLS ni de DB para roles no privilegiados).

### US-3

- **AC-3.1** — Given un Admin, when accede a la vista de audit (Fase 2 la UI, en MVP puede ser query SQL directa), then puede filtrar por rangos y actores.

---

## 5. Alcance

### Dentro

- Tabla `notifications` con estado por canal.
- Tabla `audit_log` append-only.
- Bandeja in-app + Realtime.
- Adapters de canal (in-app siempre; Slack se integra con feature 009; email opcional).
- Helpers para que otras features generen notificaciones y audit entries de forma consistente.

### Fuera (explícito)

- UI de admin para consultar audit_log — Fase 2 (en MVP se consulta con SQL/Supabase Studio).
- Reportes/exports de audit — Fase 2.
- Configuración por usuario de qué eventos notificar por qué canal — Fase 2. En MVP hay defaults sensatos.

---

## 6. Dependencias

- Se puede empezar en paralelo con **004-bookings** — pero las tablas y helpers tienen que estar antes de que **005-approval-flow** y **006-priority-reallocation** entren.
- **009-slack-integration** consume esta infraestructura como canal.

---

## 7. Preguntas abiertas

- **Q-9** (de spec §11) — Canales: in-app + Slack; email opcional. **Recomendación por defecto:** implementar in-app siempre, Slack como plugin, email diferido (a Fase 2 salvo pedido explícito).
- **Q-M** — Retención del audit_log: ¿indefinida o con TTL? **Recomendación por defecto:** indefinida en MVP; evaluar archivado a los 12–24 meses.

---

## 8. Métricas de éxito

- 100% de transiciones críticas (approve, reject, displace) tienen entrada en audit_log.
- p95 de latencia de notificación in-app (persist → render en bandeja del receptor) < 3s.
