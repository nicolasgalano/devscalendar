-- ─────────────────────────────────────────────────────────────
-- Reconstrucción tardía de una migration que ya existía en producción sin
-- archivo local. Descubierta el 2026-09-16 al arrancar feature 019: la base
-- remota tenía la fila (version=18, name=time_entries_start_time) en
-- `supabase_migrations.schema_migrations` y `time_entries.start_time`
-- físicamente aplicada, pero el repo no la contenía — cualquiera que
-- levantara la base desde cero se hubiera perdido la columna.
--
-- Este archivo repite el SQL que la CLI cree que corrió, con `if not exists`
-- para ser idempotente contra la base actual (la aplicación de esta migration
-- en prod no hace nada, la columna ya está). En una base virgen la crea.
--
-- No hubo tiempo de reconstruir el origen (posiblemente un ajuste manual
-- durante feature 016 que se coló sin PR). Anotado en `docs/deuda-tecnica.md`.
-- ─────────────────────────────────────────────────────────────

alter table public.time_entries
  add column if not exists start_time time without time zone;
