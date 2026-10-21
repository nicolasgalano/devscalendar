-- Feature: 028-projects-list-filters-and-actions
-- Purpose: RPC `security definer` que permite al admin **o al PM primario** del
--          proyecto cambiar `projects.active`. La policy `projects: admin write`
--          (migration 1) filtra al PM en silencio — mismo problema que ADR 0010
--          atacó para `reallocate_booking`: un `update` que la RLS filtra no
--          falla, lo que haría imposible distinguir "funcionó" de "no tenés
--          permiso" desde el handler. La RPC lo expresa en un solo lugar.
--
-- Aditiva pura. No altera tablas ni policies.

create or replace function public.set_project_active(
  p_project_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_active boolean;
  v_pm_id uuid;
begin
  -- 1) Lectura con lock: fija el estado "viejo" para el diff del audit y evita
  --    que dos togglers simultáneos se pisen el audit (uno escribiría old=true
  --    y el otro old=false para el mismo cambio).
  select pm_id, active
    into v_pm_id, v_current_active
    from public.projects
   where id = p_project_id
     for update;

  if v_pm_id is null then
    raise exception 'Proyecto no encontrado'
      using errcode = 'DC010';
  end if;

  -- 2) Autorización. Admin incluye `and active` adentro de has_role() (D-01),
  --    así que un admin desactivado como profile tampoco pasa. Lo mismo para
  --    el PM primario: has_role('pm') ya hereda el guard — un ex-PM con el
  --    profile dado de baja no puede togglear nada, aunque `projects.pm_id`
  --    siga apuntando a él.
  if not (
    public.has_role('admin'::public.user_role)
    or (v_pm_id = auth.uid() and public.has_role('pm'::public.user_role))
  ) then
    raise exception 'Solo admin o el PM primario puede cambiar el estado del proyecto'
      using errcode = '42501';
  end if;

  -- 3) No-op: toggle a mismo estado no mueve nada ni audita. Idempotente a
  --    propósito — un cliente que reintenta no genera trazas distintas.
  if v_current_active = p_active then
    return v_current_active;
  end if;

  -- 4) Update + audit en la misma transacción. Si el `insert` fallara, el
  --    `update` roll-backea con él y nadie queda con el estado cambiado sin
  --    rastro.
  update public.projects
     set active = p_active
   where id = p_project_id;

  insert into public.audit_log (entity, entity_id, action, actor_id, diff)
  values (
    'project',
    p_project_id,
    'active_toggled',
    auth.uid(),
    jsonb_build_object('old', v_current_active, 'new', p_active)
  );

  return p_active;
end;
$$;

revoke all on function public.set_project_active(uuid, boolean) from public;
grant execute on function public.set_project_active(uuid, boolean) to authenticated;
