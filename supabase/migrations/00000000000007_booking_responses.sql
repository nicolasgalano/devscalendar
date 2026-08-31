-- Feature: 005-approval-flow
-- Purpose: let the assigned developer answer their own bookings — approve or
--          reject — without opening anything else, and leave the trail behind.
--
-- READ plan.md §3.2 BEFORE TOUCHING THIS FILE. The policy and the column guard
-- ship in the same migration on purpose (plan.md §12): applying the policy
-- without the guard leaves a window in which any developer can rewrite their
-- own bookings — including their own hours.

-- ─────────────────────────────────────────────────────────────
-- 1. The developer's answer (plan.md §3.1)
-- ─────────────────────────────────────────────────────────────
alter table public.bookings
  add column response_note text,
  add column responded_at timestamptz;

comment on column public.bookings.response_note is
  'Why the developer rejected (mandatory) or a remark on approval (optional). bookings.note stays the PM''s original ask: reusing it would overwrite the request exactly when the PM most needs to read it.';

comment on column public.bookings.responded_at is
  'When the developer answered. Separate from updated_at, which any PM edit moves. Derived by the trigger below, never sent by a client.';

-- ─────────────────────────────────────────────────────────────
-- 2. The developer's write policy (plan.md §3.2)
-- ─────────────────────────────────────────────────────────────
-- Until now the only update policy was the PM's (`can_manage_booking`), and a
-- developer is not the PM of their project: they could not write a thing.
--
-- Policies for the same command combine with OR, so this one narrows nothing —
-- it *adds* to the developer the ability to write any column of their own rows.
-- RLS cannot express "only these columns": `with check` sees the new row alone,
-- and there is no per-column check that compares it against the old one. What
-- keeps this from becoming "the developer moves their own hours" is the guard
-- in section 3, which is why the two are one migration and not two.
create policy "bookings: developer responds"
  on public.bookings for update
  to authenticated
  using (dev_id = auth.uid())
  with check (dev_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 3. Column guard, transition guard and responded_at
-- ─────────────────────────────────────────────────────────────
-- Extends the function 004 already left in place instead of adding a second
-- trigger: two `before update` triggers on one table fire in alphabetical order
-- of their names, and making a security rule depend on that is borrowing it
-- from chance.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Everything the developer may move. A whitelist and not a list of forbidden
  -- columns on purpose: a column added by a later feature is born protected,
  -- and opening it means naming it here — which is a review, not an oversight.
  --
  -- `updated_at` is in the list because `bookings_set_updated_at` owns it; it
  -- happens to fire after this trigger today, and nothing here should depend on
  -- that ordering holding.
  responder_writable constant text[] := array['status', 'response_note', 'updated_at'];
begin
  -- ── Approving is the developer's call, not the PM's (004) ────────────────
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected')
     -- auth.uid() is null for service_role: seeds and test fixtures set states
     -- directly, and they are trusted by definition.
     and auth.uid() is not null
     and auth.uid() is distinct from new.dev_id
  then
    raise exception 'Solo el desarrollador asignado puede aprobar o rechazar una reserva'
      using errcode = 'check_violation';
  end if;

  -- ── The developer answers, and does nothing else (005, R-1) ──────────────
  -- `not can_manage_booking(...)` matters: an admin who also happens to be the
  -- assigned developer keeps editing as an admin.
  if auth.uid() is not null
     and auth.uid() = old.dev_id
     and not public.can_manage_booking(old.project_id)
  then
    if (to_jsonb(new) - responder_writable) is distinct from (to_jsonb(old) - responder_writable) then
      raise exception 'El desarrollador solo puede aprobar o rechazar una reserva'
        using errcode = 'check_violation';
    end if;

    -- Only a pending booking is answered (plan.md §3.3). Taking an answer back
    -- is a conversation with the PM, not a button (F3).
    if new.status is distinct from old.status
       and not (old.status = 'pending' and new.status in ('approved', 'rejected'))
    then
      raise exception 'Solo se puede responder una reserva que sigue pendiente'
        using errcode = 'check_violation';
    end if;
  end if;

  -- ── responded_at is derived, never sent ──────────────────────────────────
  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      new.responded_at := now();
    elsif new.status = 'pending' then
      -- Q-E sends an edited booking back to pending: the answer it carried no
      -- longer refers to what was asked, so it leaves with it. Otherwise the
      -- inbox would show a pending booking claiming it was already answered.
      new.responded_at := null;
      new.response_note := null;
    end if;
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Audit trail of the transition (plan.md §3.4)
-- ─────────────────────────────────────────────────────────────
-- Same pattern as projects_log_priority_change (ADR 0005): nobody holds
-- `insert` on audit_log, rows are only ever written by this `security definer`
-- trigger, so the trail cannot be forged from a client or from distracted
-- server-side code.
--
-- Every status change is logged, not only the developer's answer: cancelling
-- and the Q-E return to pending are exactly the history 007 and 010 hang off.
create or replace function public.bookings_log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'booking',
      new.id,
      'status_change',
      auth.uid(),
      jsonb_build_object(
        'from', old.status,
        'to', new.status,
        'response_note', new.response_note
      )
    );
  end if;
  return new;
end;
$$;

create trigger bookings_log_status_change
  after update on public.bookings
  for each row execute function public.bookings_log_status_change();
