-- Feature: 002-entities-admin
-- Purpose: minimal audit_log (see spec.md R-2) that only records project priority
--          changes for now. Feature 010-notifications-and-audit will extend this
--          table (more entity/action values, notifications) without migrating data.

-- ─────────────────────────────────────────────────────────────
-- 1. audit_log
-- ─────────────────────────────────────────────────────────────
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  -- `set null`: el rastro de auditoría sobrevive a la baja del usuario y nunca
  -- bloquea borrarlo. La fila queda con actor desconocido, no desaparece.
  actor_id uuid references public.profiles(id) on delete set null,
  diff jsonb not null,
  created_at timestamptz not null default now()
);

create index audit_log_entity_entity_id_idx on public.audit_log (entity, entity_id);

alter table public.audit_log enable row level security;

-- Only admins can read the audit trail. Nobody gets insert/update: rows are
-- only ever written by the security definer trigger below, so the log cannot be
-- forged from a client or from server-side code.
-- `service_role` sí necesita leer (feature 010 y scripts server-side) y borrar
-- (retención / limpieza de fixtures).
grant select on public.audit_log to authenticated;
grant select, delete on public.audit_log to service_role;

create policy "audit_log: admin read"
  on public.audit_log for select
  to authenticated
  using (public.current_user_role() = 'admin');

-- ─────────────────────────────────────────────────────────────
-- 2. Trigger: log project priority changes
-- ─────────────────────────────────────────────────────────────
create or replace function public.projects_log_priority_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.priority is distinct from old.priority then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'project',
      new.id,
      'priority_changed',
      auth.uid(),
      jsonb_build_object('old', old.priority, 'new', new.priority)
    );
  end if;
  return new;
end;
$$;

create trigger projects_log_priority_change
  after update on public.projects
  for each row execute function public.projects_log_priority_change();
