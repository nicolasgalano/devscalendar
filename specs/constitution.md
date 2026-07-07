# Constitution — DevsCalendar

> Principios técnicos y reglas de calidad **inmutables** para el proyecto. Cualquier decisión de una feature que los contradiga debe promoverse a ADR y modificar este documento.

Versión: 0.1 · Julio 2026

---

## 1. Stack técnico

| Capa | Tecnología | Motivo |
| :---- | :---- | :---- |
| Framework web | **Next.js** (App Router, TypeScript) | Requerido por el cliente. SSR/SSG + rutas API en un solo repo. |
| Backend / DB | **Supabase** (Postgres + PostgREST + Realtime) | Requerido por el cliente. Postgres real, RLS, Auth, Realtime, Storage. |
| Auth | **Supabase Auth** con Google OAuth | Requisito de la spec (SSO con Google, Sección 12). |
| Hosting | **Vercel** | Requerido por el cliente. Integración natural con Next.js. |
| Lenguaje | **TypeScript strict** | Reduce clase completa de bugs. `strict: true`, `noUncheckedIndexedAccess: true`. |
| Testing | Vitest + Playwright (a ratificar en ADR) | Vitest para unit/integration, Playwright para E2E del calendario. |

Cambios de stack requieren ADR y consentimiento del cliente.

---

## 2. Modelo de datos y seguridad

- **Row Level Security (RLS) es obligatoria** en toda tabla que contenga datos de negocio. Nada de "activar RLS después".
- **Multi-tenancy por cliente:** los proyectos pertenecen a un cliente; las reservas heredan cliente vía proyecto; las policies filtran por membresía.
- **Auditoría no negociable:** toda realocación por prioridad, aprobación/rechazo y cambio de estado se registra en la tabla `audit_log` (ver Sección 7 y 12 de la spec funcional).
- **Concurrencia:** la prevención de doble-booking se hace a **nivel de base de datos** (constraint o transacción serializable), no solo en UI. Requisito no funcional explícito (Sección 12 de la spec).

---

## 3. Convenciones de código

- **Formato:** Prettier con la config default. Sin discusión.
- **Lint:** ESLint con la config de Next.js + reglas TS estrictas. Cero warnings en `main`.
- **Naming:** `kebab-case` para archivos, `PascalCase` para componentes React y tipos, `camelCase` para variables/funciones, `SCREAMING_SNAKE_CASE` para constantes de módulo y env vars.
- **Server Components por defecto**, Client Components solo cuando se necesita interactividad. Marcar el límite con `"use client"` lo más profundo posible en el árbol.
- **Nada de `any` implícito ni explícito** salvo en interop con librerías sin tipos (documentar con `// TODO(types)` y ADR si es persistente).

---

## 4. Idiomas

- **Docs de producto/dominio (specs, plans, glosario, ADRs de negocio):** español.
- **Código, nombres técnicos, commits, PRs, tasks.md, mensajes de log:** inglés.
- **Copy visible al usuario final:** español (audiencia es hispanohablante — revisar si el cliente pide i18n).
- **Excepción:** términos del dominio que ya son en español y no traducen bien (`reserva`, `desplazada`, `prioritario`) se mantienen en español incluso en código, siempre que se declaren en `specs/glossary.md`.

Ver `docs/adr/0002-language-conventions.md`.

---

## 5. Calidad y gates

Un PR **no mergea** si:

1. `tsc --noEmit` falla.
2. ESLint reporta cualquier error o warning nuevo.
3. Los tests unit/integration fallan.
4. Toca una tabla nueva y no incluye policies RLS.
5. Toca lógica de doble-booking, aprobación o realocación y no incluye tests (unit + integration en DB).
6. Toca UI del calendario y no incluye una prueba visual o E2E que cubra el cambio.

Gates flexibles (con comentario en el PR justificando):

- Coverage cae >5 puntos.
- Un archivo pasa de <300 a >300 líneas.

---

## 6. Deploy y ramas

- `main` es la rama de producción. Vercel deploya `main` automáticamente a producción.
- Feature branches: `feat/NNN-slug`, `fix/short-desc`, `chore/short-desc`.
- Preview deploys automáticos en Vercel para cada PR.
- Migrations de Supabase versionadas en `supabase/migrations/` (agregar cuando se inicialice el proyecto). Se aplican vía Supabase CLI en CI.

---

## 7. Cambios a esta constitution

Cualquier cambio requiere:

1. Un ADR en `docs/adr/` explicando el motivo.
2. Ajuste de la sección afectada acá.
3. Actualización del `CLAUDE.md` si el cambio afecta cómo trabajamos día a día.
