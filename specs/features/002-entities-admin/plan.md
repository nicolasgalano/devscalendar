# Plan — Entities admin (users, clients, projects)

- **ID:** 002-entities-admin
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

ABM de `clients` y `projects` sobre RLS admin-only, extensión del trigger de provisioning de `001` para soportar invitar usuarios por email antes de su primer login, y una tabla `audit_log` mínima para registrar cambios de prioridad de proyecto.

---

## 2. Arquitectura

```
[admin UI /admin/*] → [next.js route handlers /api/clients,/api/projects,/api/users]
                              ↓
                    [supabase (rls: solo admin escribe)]
                              ↓
        [trigger: projects_log_priority_change → audit_log]
        [trigger: handle_new_user (extendido) ↔ profile_invites]
```

Sin integraciones externas reales todavía — `jira_enabled`/`slack_enabled` son flags de configuración que features `008`/`009` van a leer más adelante.

---

## 3. Modelo de datos

### Tablas nuevas

```sql
-- clients
id uuid primary key default gen_random_uuid()
name text not null unique
active boolean not null default true
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

-- projects
id uuid primary key default gen_random_uuid()
client_id uuid not null references clients(id)
name text not null
pm_id uuid not null references profiles(id)       -- PM primario (Q-A: colaboradores en Fase 2)
priority text not null default 'normal' check (priority in ('normal', 'high'))
jira_enabled boolean not null default false
slack_enabled boolean not null default false
active boolean not null default true
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (client_id, name)

-- profile_invites
email text primary key
role user_role not null
invited_by uuid references profiles(id)
created_at timestamptz not null default now()

-- audit_log (versión mínima, ver spec.md R-2)
id uuid primary key default gen_random_uuid()
entity text not null            -- 'project' por ahora
entity_id uuid not null
action text not null            -- 'priority_changed' por ahora
actor_id uuid references profiles(id)
diff jsonb not null
created_at timestamptz not null default now()
```

### Cambios a tablas existentes

- `profiles`: agregar `primary_pm_id uuid references profiles(id)` nullable (AC-3.2). Validación de que apunte a un profile con `role = 'pm'` queda en la capa de aplicación (R-3 — Postgres no puede expresar ese check entre filas sin un trigger dedicado, y no se justifica el costo para el MVP).
- `handle_new_user()` (de `001`): antes de insertar el profile, busca `profile_invites` por email. Si hay match: usa ese `role`, borra la invitación. Si no: `role = null` (comportamiento actual, sin cambios).

### RLS policies

- `clients`, `projects`: `select` para todo `authenticated`; `insert/update/delete` solo `current_user_role() = 'admin'`. Mismos grants de tabla explícitos que `profiles` (recordar el bug de `001` — sin `grant` no alcanza con la policy).
- `profile_invites`: todas las operaciones (`select/insert/delete`) solo `admin`. Nadie más necesita verla.
- `audit_log`: `select` solo `admin`; `insert` únicamente vía el trigger (`security definer`), nunca directo desde un cliente.

### Índices

- `projects(client_id)` — listado de proyectos por cliente.
- `projects(pm_id) where active` — candidatos de un PM.
- `audit_log(entity, entity_id)` — historial de una entidad puntual.

---

## 4. API surface

### Route handlers Next.js

| Método | Ruta | Body / query | Response | Auth |
| :---- | :---- | :---- | :---- | :---- |
| POST | `/api/clients` | `{ name }` | `Client` | admin |
| PATCH | `/api/clients/[id]` | `{ name?, active? }` | `Client` | admin |
| POST | `/api/projects` | `{ name, clientId, pmId, priority, jiraEnabled, slackEnabled }` | `Project` | admin |
| PATCH | `/api/projects/[id]` | `{ name?, pmId?, priority?, jiraEnabled?, slackEnabled?, active? }` | `Project` | admin |
| POST | `/api/users` | `{ email, role }` | `Profile \| ProfileInvite` | admin |
| PATCH | `/api/users/[id]` | `{ role?, active?, primaryPmId? }` | `Profile` | admin |

`POST /api/users`: si ya existe un `auth.users` con ese email, asigna el rol directo sobre `profiles`; si no existe, inserta en `profile_invites` (se resuelve en el próximo login vía trigger).

### Server actions

No se usan — todo pasa por route handlers para poder testear con Vitest igual que `001`.

---

## 5. UI

### Componentes principales

- `AdminClientsTable` — `/admin/clients`, lista + alta/edición/desactivación.
- `AdminProjectsTable` — `/admin/projects`, lista + alta/edición (cliente, PM, prioridad, integraciones).
- `AdminUsersTable` — `/admin/users`, lista + alta por email/rol + edición de rol/`primary_pm_id`.
- Todos construidos sobre shadcn/ui (`Button`, `Dialog`, `Input`, `Select`, `Table`, `DropdownMenu`) instalado on-demand acá (primer uso real de shadcn en el repo).

### Estados clave

- Loading: skeleton de tabla. Empty: mensaje + CTA de alta. Error: toast/inline con mensaje en español.

### Interacciones críticas

- Desactivar un cliente con proyectos activos: modal de confirmación explícita (AC-1.2), no un bloqueo duro.
- Alta de usuario con email ya existente como profile: error claro ("ese usuario ya existe") en vez de duplicar.

---

## 6. Integraciones externas

Ninguna todavía. `jira_enabled`/`slack_enabled` son booleans de configuración; la integración real (llamadas a la API de Jira/Slack) es responsabilidad de `008-jira-integration` y `009-slack-integration`.

---

## 7. Dependencias entre features

- Requiere `001-auth-and-permissions` (enum de roles, `profiles`, `current_user_role()`, patrón de RLS).
- Bloquea `003-calendar-ui` y `004-bookings` (necesitan clientes/proyectos/devs reales para tener contra qué reservar).

---

## 8. Riesgos y mitigaciones

Ver `spec.md` §9 (R-1, R-2, R-3) — el mecanismo de invitación por email, el alcance mínimo de `audit_log`, y la validación de rol de `pm_id`/`primary_pm_id` en capa de aplicación en vez de constraint de DB.

---

## 9. Alternativas consideradas

- **Enum de Postgres para `priority`** en vez de `check (priority in (...))`: se descartó por ahora porque un `check` es más fácil de migrar si Q-2 de la spec funcional (2 niveles vs esquema numérico P0–P3) se resuelve distinto — cambiar un `check` es una migration simple, alterar un enum con valores en uso es más costoso.
- **Multi-PM por proyecto** (tabla junction `project_pms`): descartado para MVP por Q-A (PM primario obligatorio alcanza); se puede agregar sin romper el modelo actual (`pm_id` queda como el primario).
- **Invitación por magic link** (Supabase `inviteUserByEmail`) en vez de `profile_invites` + login con Google: se descartó porque el flujo de auth ya está 100% comprometido con Google OAuth (`001`); mezclar un segundo mecanismo de login solo para invitados agrega complejidad sin necesidad real.

---

## 10. Testing strategy

- **Unit:** validación Zod de los payloads de `/api/clients`, `/api/projects`, `/api/users` (happy path + al menos 2 casos inválidos c/u).
- **Integration (DB):** RLS de `clients`/`projects`/`profile_invites` (admin vs no-admin); trigger `handle_new_user` con y sin invite; trigger de `audit_log` en cambio de prioridad.
- **E2E:** un admin crea cliente → proyecto → usuario desde `/admin/*` y los ve listados (flujo feliz completo).
- **Manual:** ninguno específico — no hay UI de calendario todavía en esta feature.

---

## 11. Rollout

- Feature flag: no.
- Migraciones destructivas: no (todas las tablas son nuevas o agregan columnas nullable).
- Plan de rollback: sin datos productivos todavía (`clients`/`projects` no existen en ningún ambiente real), un `supabase db reset` o un `drop table` revierte limpio si algo sale mal antes de mergear a `main`.
