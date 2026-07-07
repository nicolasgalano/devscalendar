# Spec — Entities admin (users, clients, projects)

- **ID:** 002-entities-admin
- **Estado:** draft
- **Referencias en la spec funcional:** §3 (permisos del Admin), §10 (modelo de datos)

---

## 1. Objetivo

Permitir al Administrador dar de alta, editar y desactivar los datos maestros del sistema: usuarios (con rol), clientes y proyectos (con prioridad e integraciones configuradas).

---

## 2. Contexto

El calendario y las reservas necesitan estos maestros como precondición. Sin proyectos con prioridad configurada, no hay realocación posible; sin devs cargados, no hay a quién reservar.

---

## 3. User stories

- **US-1** — Como Admin, quiero crear/editar/desactivar clientes, para gestionar la cartera.
- **US-2** — Como Admin, quiero crear/editar/desactivar proyectos y asignar su prioridad, PM responsable e integración (Jira/Slack), para habilitar las reservas.
- **US-3** — Como Admin, quiero crear usuarios con email y rol, para que puedan loguearse cuando sean invitados.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un Admin autenticado, when crea un cliente con nombre único, then queda persistido y visible en la lista.
- **AC-1.2** — Given un cliente con proyectos activos, when el Admin intenta borrarlo, then se le pide desactivar (soft delete) en vez de borrar.

### US-2

- **AC-2.1** — Given un proyecto nuevo, when se crea, then requiere: nombre, cliente, PM responsable, prioridad (prioritario/común), integración configurada (jira, slack, ambas, ninguna).
- **AC-2.2** — Given un proyecto activo, when se cambia su prioridad, then el cambio se registra en `audit_log` y no afecta reservas ya aprobadas retroactivamente.

### US-3

- **AC-3.1** — Given un Admin, when crea un usuario con email, then el usuario recibe la posibilidad de loguear con Google en ese email; no se genera password.
- **AC-3.2** — Given un usuario Dev, when se le asigna un PM primario (opcional), then queda listado como candidato natural para las reservas de proyectos de ese PM.

---

## 5. Alcance

### Dentro

- ABM de clientes, proyectos, usuarios.
- Soft delete (desactivación) en lugar de delete físico para clientes y proyectos con historial.
- UI de administración protegida por rol Admin.

### Fuera (explícito)

- Import masivo desde CSV / Google Sheets.
- Historial de cambios visible en UI (queda en `audit_log` pero sin pantalla dedicada en MVP).
- Auto-sincronización con Jira projects o Slack workspaces (los proyectos se dan de alta manualmente y se linkean).

---

## 6. Dependencias

- **001-auth-and-permissions** — necesita el enum de roles y las policies base.

---

## 7. Preguntas abiertas

- **Q-A** — ¿Un proyecto puede tener múltiples PMs? La spec funcional habla de "el PM" en singular. **Recomendación por defecto:** un PM primario obligatorio; PMs adicionales como colaboradores (Fase 2).
- **Q-B** — ¿Un dev puede pertenecer a múltiples "equipos" o clientes simultáneamente? **Recomendación por defecto:** sí, un dev es transversal; las reservas lo asignan a proyectos específicos.

---

## 8. Métricas de éxito

- Un admin puede dejar el sistema listo para operar (crear cliente + proyecto + PM + 3 devs) en <5 minutos.
