-- ─────────────────────────────────────────────────────────────
-- Feature 025 — Documentos y PDFs en adjuntos de tickets.
--
-- Extiende la tabla `ticket_attachments` de 020 para aceptar también PDFs y
-- archivos de Office (Word, Excel). Es una migration ADITIVA PURA: no toca
-- RLS, triggers, policies, grants ni indices.
--
-- Dos cambios:
--
--   1. `thumb_object_key`, `width`, `height` pasan a NULLABLE. Los archivos
--      no-imagen no tienen thumbnail WebP generado en cliente ni dimensiones
--      extraíbles; el handler POST deja esas columnas vacías para ellos. Los
--      adjuntos existentes de 020 (todos imágenes) siguen con esas columnas
--      llenas — nunca se tocan.
--
--   2. El check de `size_bytes` sube de 5 MB a 10 MB (`<= 10485760`). Un PDF
--      del cliente suele pesar 5-8 MB; 10 MB resuelve el 99% sin esfuerzo.
--      El nuevo check es más laxo que el anterior → ningún archivo existente
--      lo viola.
--
-- La feature mantiene toda la infra de 020: bucket `ticket-attachments`
-- privado, policies de RLS, trigger de audit, trigger de notificación
-- (`ticket_attachment_added` del plan 010). Nada de eso se duplica ni se
-- reescribe acá.
--
-- Nombre del constraint: Postgres nombra los checks inline como
-- `<table>_<col>_check` por default. En la migration 20 el check se declaró
-- inline en el `create table`, así que debería estar como
-- `ticket_attachments_size_bytes_check`. Si en algún entorno quedó distinto,
-- esta migration falla ruidoso en el `drop constraint` — mejor que silenciar
-- (R-9 del plan).
--
-- Regla de dos fases (CLAUDE.md): se puede aplicar antes del deploy del
-- código nuevo sin romper lo deployado. El código viejo que lee las tres
-- columnas sigue recibiendo valores no-null para las filas existentes, y el
-- check nuevo no rechaza nada que antes aceptaba. Fase 2 posterior: no hay
-- (la migration es terminal).
-- ─────────────────────────────────────────────────────────────

alter table public.ticket_attachments
  alter column thumb_object_key drop not null,
  alter column width drop not null,
  alter column height drop not null;

alter table public.ticket_attachments
  drop constraint ticket_attachments_size_bytes_check;

alter table public.ticket_attachments
  add constraint ticket_attachments_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 10485760);
