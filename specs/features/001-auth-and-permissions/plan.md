# Plan — Auth & permissions

- **ID:** 001-auth-and-permissions
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Se usa **Supabase Auth con Google OAuth** para la autenticación, integrado a Next.js App Router mediante el paquete `@supabase/ssr` (que maneja cookies y sesión en Server Components, Route Handlers y Middleware).

La autorización vive en dos capas:

- **Row Level Security** en Postgres, con políticas por tabla usando `auth.uid()` y el `role` del usuario leído desde la tabla `profiles`.
- **Middleware de Next.js** que redirige a `/login` si no hay sesión y refresca el token en cada request.

---

## 2. Arquitectura

```
┌─────────────┐    ┌───────────────────┐    ┌──────────────────┐
│   Browser   │ ─→ │  Next.js middleware│ ─→ │  Route handlers  │
│  (cookies)  │    │  (refresh session) │    │ + Server Components│
└─────────────┘    └───────────────────┘    └────────┬─────────┘
                                                     │
                                                     ▼
                                    ┌────────────────────────────┐
                                    │   Supabase (Auth + Postgres)│
                                    │  RLS on every business table│
                                    └────────────────────────────┘
```

Google OAuth flow:

1. Usuario clickea "Continuar con Google" en `/login`.
2. Redirect a Supabase → Google → Supabase → `/auth/callback?code=...`.
3. `/auth/callback` intercambia el code por sesión y guarda cookies. Redirige a `/`.
4. Un trigger de Postgres crea la fila en `profiles` si no existe (con `role = null`, requiere que un admin lo active).

---

## 3. Modelo de datos

### Tablas nuevas

```sql
-- Enum de roles (extensible: 'client' se agregará en Fase 2)
create type public.user_role as enum ('admin', 'pm', 'developer');

-- Perfil de aplicación linkeado a auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  role public.user_role,          -- null = usuario no autorizado todavía
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.profiles (role) where active;
```

### RLS policies

```sql
alter table public.profiles enable row level security;

-- Todo usuario autenticado puede leer su propio perfil.
create policy "profiles: self read"
  on public.profiles for select
  using (auth.uid() = id);

-- Un admin puede leer todos los perfiles.
create policy "profiles: admin read all"
  on public.profiles for select
  using (public.current_user_role() = 'admin');

-- Solo un admin puede insertar/actualizar perfiles (role/active).
create policy "profiles: admin manage"
  on public.profiles for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
```

Función helper (SECURITY DEFINER para evitar recursion en policies):

```sql
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;
```

### Trigger de auto-provisioning

```sql
-- Al crearse un auth.users, insertamos una fila en profiles con role = null.
-- Un admin debe activar el rol antes de que pueda operar.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## 4. API surface

### Route handlers Next.js

| Método | Ruta | Función | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/auth/callback` | Intercambia el `code` de OAuth por sesión, guarda cookies, redirige a `?next` o `/`. | público |
| POST | `/auth/signout` | Cierra sesión (limpia cookies) y redirige a `/login`. | autenticado |

### Server helpers (`src/lib/supabase/`)

- `createServerClient()` — cliente para Server Components y Route Handlers.
- `createBrowserClient()` — cliente para Client Components.
- `updateSession(request)` — helper del middleware; refresca cookies.

---

## 5. UI

### Componentes principales

- `src/app/login/page.tsx` — landing pública con un botón "Continuar con Google".
- `src/app/page.tsx` — home autenticada; en 001 muestra "Hola {name}, tu rol es {role}" o un mensaje si no tiene rol asignado.
- `src/middleware.ts` — redirige a `/login` si no hay sesión, y a `/pending-access` si hay sesión pero `role IS NULL` (o `active = false`).

### Estados clave

- No autenticado → redirige a `/login`.
- Autenticado sin rol → `/pending-access` (pantalla informativa).
- Autenticado con rol → home según rol (en 001 basta con la home genérica; el routing por rol llega con features posteriores).

---

## 6. Integraciones externas

**Google OAuth** (configurado en el proyecto Supabase, no en la app):

- Scopes iniciales: `openid`, `email`, `profile`.
- Scope adicional `https://www.googleapis.com/auth/calendar.events` se agrega en feature 007 cuando corresponda (no ahora, para no pedir permisos innecesarios).
- Redirect URI configurada en Google Cloud Console: `<supabase-url>/auth/v1/callback`.

---

## 7. Dependencias entre features

- **Ninguna previa.**
- **Desbloquea:** todas las demás.

---

## 8. Riesgos y mitigaciones

- **R-1** — RLS mal diseñada permite lectura cruzada de perfiles. **Mitigación:** tests de integración que autentican como dos usuarios distintos y verifican aislamiento.
- **R-2** — Recursion en policies cuando la policy consulta `profiles` para chequear el rol del propio `profiles`. **Mitigación:** función `current_user_role()` con `SECURITY DEFINER` que hace bypass de RLS en la lectura del rol.
- **R-3** — Middleware con `@supabase/ssr` tiene rincones (orden de cookies, respuesta con `NextResponse.next()`). **Mitigación:** copiar el patrón exacto de la doc oficial; smoke test E2E temprano.

---

## 9. Alternativas consideradas

- **NextAuth.js (Auth.js) con Google + adapter Supabase:** más flexible pero duplica la capa de auth. Supabase Auth es suficiente y ya nos da la sesión que RLS usa.
- **Clerk:** DX excelente pero suma otro vendor y no aporta valor sobre Supabase Auth para este caso.

---

## 10. Testing strategy

- **Unit:** función `current_user_role()` — no aplica (es SQL puro). Helpers TS mínimos.
- **Integration (DB):**
  - Crear dos users, insertar profiles, ejecutar queries autenticado como cada uno y verificar aislamiento.
  - Verificar que el trigger `handle_new_user` crea la fila en profiles al insertar en `auth.users`.
- **E2E:**
  - Un test de Playwright que abre `/`, verifica redirect a `/login`, y (con mock/bypass de Google OAuth para test) completa el login y verifica llegar a home. **Nota:** el OAuth real con Google no es testeable en CI limpio; usar Supabase local con el proveedor "email link" habilitado como bypass en el entorno de test, o mocking del provider.

---

## 11. Rollout

- Feature flag: no. Es el paso 0 — sin auth no arranca nada.
- Migraciones destructivas: no (creación de nuevas entidades).
- Plan de rollback: revertir la migración `00000000000000_auth_and_profiles.sql` con un archivo `down` (a mano si hace falta).
