# Tasks — Notificar al PM primario cuando cambia el status de un ticket

- **ID:** 023-notify-pm-on-status-change
- **Plan reference:** `./plan.md`
- **Spec reference:** `./spec.md`
- **Estado:** draft

Legend: `[ ]` open · `[x]` done · `[~]` in progress.

Una sola phase.

---

## Phase 1 — Migration + deploy

- [ ] **T1.1** — Migration `supabase/migrations/00000000000022_status_change_notify_pm.sql`: `create or replace function public.notify_ticket_events()` con el cuerpo completo. Preserva todas las ramas heredadas de 021 y suma **una tercera invocación** en la rama de status change al PM primario del proyecto, con `distinct from` en tres direcciones para evitar duplicados con actor/assignee/creador.
  - _DoD:_ el archivo se lee y explica el "por qué" en el header. `db:push` limpio.

- [ ] **T1.2** — `pnpm db:push`. Sin `db:types` porque no cambia schema.

- [ ] **T1.3** — Verificación manual: cambiar el status de un ticket (kanban o detalle), confirmar que el PM primario del proyecto ve la notificación en su campana.

- [ ] **T1.4** — Cierre docs:
  - `specs/features/README.md`: fila 023 → `done (deployed YYYY-MM-DD)`.
  - `CLAUDE.md` sección "Notificaciones": nota mencionando que `ticket_status_changed` ahora incluye al PM primario.

- [ ] **T1.5** — Merge feature/023 → develop → main.

---

## Blocked / follow-ups

- [ ] **F1** — Smoke SQL de la nueva rama (cuando el proyecto tenga infra de integration tests sobre tickets/project_members). Cubierto por verificación visual + inspección directa de `notifications`.
- [ ] **F2** — Preferencias por-usuario (fase 2 de `010`, común con F2 de `022`).
