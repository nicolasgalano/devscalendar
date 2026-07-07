# Spec — Auth & permissions

- **ID:** 001-auth-and-permissions
- **Estado:** draft
- **Referencias en la spec funcional:** §3 (roles y permisos), §12 (seguridad)

---

## 1. Objetivo

Autenticar usuarios con Google SSO y autorizar sus acciones según rol (Admin, PM, Desarrollador, Cliente opcional), con aislamiento de datos entre clientes garantizado por Row Level Security de Supabase.

---

## 2. Contexto

Es la feature 0 del MVP: sin identidad no hay reservas, ni filtros, ni auditoría posibles. El requisito de SSO con Google viene de la Sección 12 y también facilita la integración posterior con Google Calendar (mismo proveedor OAuth).

---

## 3. User stories

- **US-1** — Como usuario del sistema, quiero iniciar sesión con mi cuenta de Google, para no tener que gestionar otra contraseña.
- **US-2** — Como administrador, quiero asignar un rol a cada usuario (Admin/PM/Dev), para que el sistema aplique los permisos correspondientes.
- **US-3** — Como usuario, quiero que la aplicación me muestre solamente los datos que tengo permiso para ver, sin filtrar del lado del cliente.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un usuario no autenticado, when accede a cualquier ruta protegida, then es redirigido al login.
- **AC-1.2** — Given un usuario que hace login con Google exitosamente, when el email corresponde a un usuario dado de alta en el sistema, then queda logueado y ve la home según su rol.
- **AC-1.3** — Given un login exitoso con un email que **no** está dado de alta, then se muestra un mensaje claro ("tu cuenta no está autorizada, contactá a un admin") y no queda sesión iniciada.

### US-2

- **AC-2.1** — Given un usuario con rol Admin, when abre la pantalla de usuarios, then puede crear un usuario nuevo indicando email y rol.
- **AC-2.2** — Given un usuario existente, when un admin cambia su rol, then el cambio se aplica en el próximo request del usuario afectado (sin necesidad de que cierre sesión).

### US-3

- **AC-3.1** — Given un dev intenta consultar la lista de reservas de un proyecto del que no participa, then la API devuelve solo las reservas que le pertenecen o (según decisión abierta Q-5) el calendario global en modo lectura.
- **AC-3.2** — Given un PM intenta editar una reserva de otro PM sobre un proyecto que no le pertenece, then la operación es rechazada por RLS con `permission denied`.

---

## 5. Alcance

### Dentro

- Login con Google OAuth vía Supabase Auth.
- Modelo de roles (Admin, PM, Dev; Cliente diferido, ver Q-6).
- Tabla `profiles` linkeada a `auth.users` con `role`.
- RLS policies base para las tablas maestras.
- Guardas de ruta en Next.js (middleware).

### Fuera (explícito)

- Otros proveedores de OAuth (Microsoft, GitHub).
- 2FA / MFA.
- Auto-provisioning de usuarios desde Google Workspace.
- Rol Cliente (stakeholder externo) — Fase 2, ver Q-6.

---

## 6. Dependencias

- Ninguna feature previa.
- Externa: Google OAuth credentials (client ID + secret) configurados en Supabase.

---

## 7. Preguntas abiertas

- **Q-5** (de spec §11) — ¿El dev ve el calendario global o solo el suyo? **Recomendación por defecto:** global en modo lectura. **Bloquea:** RLS policies de `bookings`.
- **Q-6** (de spec §11) — ¿El rol Cliente accede a la plataforma? **Recomendación por defecto:** Fase 2. **Bloquea:** modelado del enum de roles — se puede dejar el enum extensible.

---

## 8. Métricas de éxito

- 100% de acciones sensibles pasan por RLS (no hay backdoors por service role en rutas de usuario).
- 0 incidentes de acceso cruzado entre clientes en el primer trimestre post-launch.

---

## 9. Riesgos conocidos

- **R-1** — Un mal diseño de RLS obliga a re-migrar toda la data después. **Mitigación:** validar policies con tests de integración desde la primera tabla.
- **R-2** — El middleware de Next.js con Supabase Auth tiene rincones sutiles (cookies SSR). **Mitigación:** seguir la guía oficial de Supabase para App Router; escribir un smoke test E2E de login temprano.
