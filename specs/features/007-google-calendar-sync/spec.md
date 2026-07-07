# Spec — Google Calendar push integration

- **ID:** 007-google-calendar-sync
- **Estado:** draft
- **Referencias en la spec funcional:** §8.1 (Google Calendar)

---

## 1. Objetivo

Reflejar las reservas aprobadas del dev en su Google Calendar personal como eventos, manteniendo sincronizados los cambios y las cancelaciones (push unidireccional en MVP).

---

## 2. Contexto

Formaliza el compromiso del dev en la herramienta que ya usa (Google Calendar), evitando que tenga que abrir DevsCalendar para saber qué le toca. La spec funcional lo lista como parte del alcance del MVP.

---

## 3. User stories

- **US-1** — Como Dev, quiero que mis reservas aprobadas aparezcan en mi Google Calendar automáticamente, para verlo en la herramienta que ya uso.
- **US-2** — Como Dev, quiero que si el PM edita o cancela una reserva, el cambio se refleje en mi Google Calendar sin acción de mi parte.
- **US-3** — Como sistema, quiero degradar limpiamente si la API de Google falla, para que no bloquee el resto del flujo.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given una reserva pasa a `approved`, when la transición se persiste, then se crea un evento en el Google Calendar del dev con: título "[<Proyecto>] <ticket>", inicio, fin, asistente = dev, descripción con link al ticket y a la reserva en DevsCalendar.
- **AC-1.2** — El evento se crea en el calendario primario del dev (o en un calendario dedicado configurable — ver Q-H).

### US-2

- **AC-2.1** — Given una reserva `approved` se edita (nueva franja u otros metadatos visibles), when se guarda, then el evento en GCal se actualiza (`patch`) manteniendo el mismo `eventId`.
- **AC-2.2** — Given una reserva `approved` se cancela o desplaza, when la transición ocurre, then el evento en GCal se borra.

### US-3

- **AC-3.1** — Given la API de Google falla, when se intenta crear/actualizar/borrar un evento, then la operación se pone en una cola de retry con backoff exponencial; la reserva en DevsCalendar **no** se revierte.
- **AC-3.2** — Given un retry supera N intentos, then se genera un alerta interna y se marca la reserva con un flag `gcal_sync_error` para que el admin pueda revisarla.

---

## 5. Alcance

### Dentro

- OAuth del dev con Google (delegated permission `calendar.events`).
- Job/route handler que reacciona a transiciones de estado y sincroniza.
- Cola con retry para tolerar fallos transitorios.
- Almacenamiento del `gcal_event_id` en la reserva para updates/deletes.

### Fuera (explícito)

- Sync bidireccional (leer eventos existentes del dev para prevenir doble-booking) — Fase 2 (§8.1 spec).
- Sincronización con otros proveedores (Outlook, etc.).

---

## 6. Dependencias

- **001-auth-and-permissions** — el SSO con Google ya deja tokens; ampliar scopes.
- **005-approval-flow** — el trigger es la transición a `approved`.

---

## 7. Preguntas abiertas

- **Q-3** (de spec §11) — Push MVP, bidireccional Fase 2. Confirmado.
- **Q-H** — ¿Calendario primario o uno dedicado ("DevsCalendar bookings")? **Recomendación por defecto:** dedicado, creado la primera vez que el dev linkea su cuenta. Menos ruido en su calendario personal.
- **Q-I** — Qué hacer si el dev revoca los permisos post-linking. **Recomendación por defecto:** marcar el link como broken; el sistema sigue funcionando pero avisa al dev en la UI.

---

## 8. Métricas de éxito

- p95 de latencia approve → evento visible en GCal < 30s.
- Tasa de éxito de sync ≥ 99% (medida sobre transiciones intentadas).
