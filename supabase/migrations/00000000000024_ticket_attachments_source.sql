-- ─────────────────────────────────────────────────────────────
-- Feature 026 — Pegar imágenes en el editor rich text.
--
-- Agrega una columna informativa a `ticket_attachments` para distinguir cómo
-- entró el adjunto al ticket: por el botón "Subir imagen" del panel (`panel`)
-- o pegado/dropeado directamente en el editor rich text (`paste`). Es una
-- migration ADITIVA PURA: no toca RLS, triggers, policies, grants ni índices,
-- y el default cubre a todas las filas existentes de 020/025 con 'panel' —
-- que es el valor histórico correcto porque hasta esta feature no había otra
-- forma de entrar.
--
-- La columna NO se usa en ninguna policy ni función; existe solo para que la
-- UI pueda mostrar un badge sutil ("pegado desde el portapapeles") en el panel
-- y para que el equipo pueda medir adopción del nuevo flujo con una query
-- contra `source = 'paste'` después del deploy (ver §8 de spec).
-- ─────────────────────────────────────────────────────────────

alter table public.ticket_attachments
  add column source text not null default 'panel'
  check (source in ('panel', 'paste'));

comment on column public.ticket_attachments.source is
  'How the attachment entered the ticket: ''panel'' (explicit upload button) or ''paste'' (pasted/dropped into the rich text editor). Informative only — no RLS, trigger, or policy depends on this value.';
