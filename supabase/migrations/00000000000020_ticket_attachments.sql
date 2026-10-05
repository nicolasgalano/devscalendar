-- ─────────────────────────────────────────────────────────────
-- Feature 020 — Adjuntos (imágenes) en tickets.
--
-- Tabla nueva `ticket_attachments` que registra metadata de cada adjunto,
-- más un bucket privado `ticket-attachments` de Supabase Storage donde
-- viven dos objetos por fila: el original y un thumbnail WebP generado en
-- el cliente antes del upload.
--
-- Path structure en el bucket:
--   tickets/<ticket_id>/original/<uuid>-<slug>.<ext>
--   tickets/<ticket_id>/thumb/<uuid>-<slug>.webp
--
-- RLS: los adjuntos siguen la visibilidad del ticket (via can_view_project).
-- Insert requiere ser contributor+ del proyecto (la granularidad "puedo
-- editar ESTE ticket específico" vive en el handler). Delete permite al
-- autor + PM primario + admin — nunca a un contributor ajeno.
--
-- El bucket es privado. El cliente NUNCA sube ni descarga directo — todo
-- pasa por handlers que autorizan primero y firman URLs con expiración
-- corta (15 min). Storage insert/delete se hacen desde el server con
-- service_role. Storage select tiene policy que valida can_view_project.
--
-- Cero migrations breaking: es aditiva pura. Sale con `db:push` antes del
-- deploy del código de 020 (regla de dos fases del CLAUDE.md).
-- ─────────────────────────────────────────────────────────────

-- 1. Tabla ─────────────────────────────────────────────────────
create table public.ticket_attachments (
  id                 uuid primary key default gen_random_uuid(),
  ticket_id          uuid not null references public.tickets(id) on delete cascade,
  -- project_id denormalizado (patrón de tickets, time_entries, sprints) para
  -- RLS eficiente sin joins. Se garantiza consistente con el ticket via
  -- constraint de trigger — o al menos vía convención en el handler que
  -- inserta usando el project_id del ticket que ya cargó.
  project_id         uuid not null references public.projects(id) on delete cascade,
  -- Paths en el bucket. El cliente NUNCA los ve directamente — se piden
  -- signed URLs por handler que valida permisos.
  object_key         text not null,
  thumb_object_key   text not null,
  -- Metadata del archivo tal como vino del cliente.
  original_filename  text not null,
  mime_type          text not null,
  size_bytes         integer not null check (size_bytes > 0 and size_bytes <= 5242880), -- 5 MB
  -- Dimensiones del original — extraídas en cliente con createImageBitmap.
  -- Se usan para calcular aspect-ratio en el layout del panel y del
  -- lightbox sin necesidad de descargar el binario.
  width              integer not null check (width > 0 and width <= 20000),
  height             integer not null check (height > 0 and height <= 20000),
  -- on delete set null: dar de baja a un usuario nunca puede bloquear la
  -- limpieza. La UI muestra "subido por —" cuando el uploader se borró.
  uploaded_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

comment on table public.ticket_attachments is
  'Adjuntos (imágenes) de tickets — feature 020. Original y thumb WebP viven '
  'en el bucket privado `ticket-attachments`. El thumb se genera en cliente '
  'con Canvas antes del upload — cero server-side image processing.';

comment on column public.ticket_attachments.object_key is
  'Path del original en el bucket `ticket-attachments`. Formato: '
  'tickets/<ticket_id>/original/<uuid>-<slug>.<ext>';

comment on column public.ticket_attachments.thumb_object_key is
  'Path del thumbnail WebP en el bucket. Formato: '
  'tickets/<ticket_id>/thumb/<uuid>-<slug>.webp. Siempre es WebP y siempre '
  'pesa < 100 KB.';

create index ticket_attachments_ticket_id_idx on public.ticket_attachments (ticket_id);
create index ticket_attachments_project_id_idx on public.ticket_attachments (project_id);

-- 2. RLS ────────────────────────────────────────────────────────
alter table public.ticket_attachments enable row level security;

-- Grants a authenticated. NO update: la tabla es inmutable (no hay campos
-- editables). Sin update, no hay policy de update y por lo tanto no hay
-- forma de modificar una fila.
grant select, insert, delete on public.ticket_attachments to authenticated;

create policy "ticket_attachments: read"
  on public.ticket_attachments for select
  to authenticated
  using (public.can_view_project(project_id));

-- Insert: la RLS acota a contributor+ del proyecto (lead o contributor con
-- membresía activa, admin, PM primario). La regla granular "este ticket
-- puntual permite escritura" vive en el handler con `canEditTicket` — misma
-- separación que time_entries en 016.
create policy "ticket_attachments: insert"
  on public.ticket_attachments for insert
  to authenticated
  with check (
    public.role_in_project(project_id) in ('contributor', 'lead')
    or public.is_admin()
    or public.is_pm_of_project(project_id)
  );

create policy "ticket_attachments: delete"
  on public.ticket_attachments for delete
  to authenticated
  using (
    uploaded_by = auth.uid()
    or public.is_admin()
    or public.is_pm_of_project(project_id)
  );

-- 3. Trigger de audit ──────────────────────────────────────────
-- Insert: snapshot mínimo con los datos suficientes para reconstruir "quién
-- subió qué a dónde".
--
-- Delete: snapshot COMPLETO. Motivo: si un PM/admin borró un adjunto de un
-- contributor, la fila ya no existe y el object del bucket tampoco — el
-- audit_log es la única evidencia. Sigue el patrón de time_entries en 016.
create or replace function public.audit_ticket_attachment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket_attachment', new.id, 'create', actor_id,
      jsonb_build_object(
        'ticket_id', new.ticket_id,
        'original_filename', new.original_filename,
        'size_bytes', new.size_bytes,
        'mime_type', new.mime_type
      )
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (entity, entity_id, action, actor_id, diff)
    values (
      'ticket_attachment', old.id, 'delete', actor_id,
      jsonb_build_object(
        'ticket_id', old.ticket_id,
        'project_id', old.project_id,
        'original_filename', old.original_filename,
        'size_bytes', old.size_bytes,
        'mime_type', old.mime_type,
        'width', old.width,
        'height', old.height,
        'uploaded_by', old.uploaded_by,
        'object_key', old.object_key,
        'thumb_object_key', old.thumb_object_key,
        'created_at', old.created_at
      )
    );
    return null;
  end if;

  return null;
end;
$$;

revoke all on function public.audit_ticket_attachment_events() from public;

create trigger ticket_attachments_audit
  after insert or delete on public.ticket_attachments
  for each row execute function public.audit_ticket_attachment_events();

-- 4. Bucket de Storage ─────────────────────────────────────────
-- Se crea el bucket como código (idempotente con `on conflict do nothing`)
-- para que cualquiera que levante la base desde cero tenga el mismo estado.
-- `public = false` significa que las signed URLs son la única forma de
-- acceder a los objetos.
insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;

-- 5. Storage RLS ───────────────────────────────────────────────
-- Read: espeja `can_view_project` via join con la tabla ticket_attachments.
-- El path del object (`storage.objects.name`) matchea `object_key` o
-- `thumb_object_key`, y de ahí se obtiene el `project_id` que se valida
-- contra `can_view_project`.
--
-- Sin policy de insert/delete para authenticated. El cliente NUNCA escribe
-- directo — el server usa service_role para subir/borrar. Esto también
-- protege contra un cliente malicioso que arme un path arbitrario e intente
-- subir algo sin pasar por el handler.
create policy "ticket-attachments: read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1
      from public.ticket_attachments ta
      where (ta.object_key = storage.objects.name
             or ta.thumb_object_key = storage.objects.name)
        and public.can_view_project(ta.project_id)
    )
  );
