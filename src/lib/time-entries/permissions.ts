import { isAdmin, type UserRole } from "@/lib/auth/roles";

const EDIT_WINDOW_DAYS = 7;

export type TimeEntryViewer = { id: string; roles: UserRole[] };
export type TimeEntryForCheck = { user_id: string; logged_at: string };

/**
 * Réplica cliente de la regla del handler PATCH/DELETE (016 AC-5). Admin sin
 * límite; propio dentro de 7 días desde `logged_at`. La verdad la tiene el
 * server — este helper decide qué botones dibujar.
 */
export function canEditTimeEntry(
  viewer: TimeEntryViewer | null,
  entry: TimeEntryForCheck,
): boolean {
  if (!viewer) return false;
  if (isAdmin(viewer.roles)) return true;
  if (viewer.id !== entry.user_id) return false;
  return isWithinEditWindow(entry.logged_at);
}

export function isWithinEditWindow(loggedAt: string): boolean {
  const logged = new Date(`${loggedAt}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (today.getTime() - logged.getTime()) / (1000 * 60 * 60 * 24),
  );
  return diffDays <= EDIT_WINDOW_DAYS;
}
