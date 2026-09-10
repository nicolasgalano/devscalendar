import type { Database } from "@/types/database";

export type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * Roles are a **set**, not a value (feature 012, settling D-09). Someone can be
 * a PM and an admin at the same time, which the team needed and the old
 * `profiles.role` column could not express.
 *
 * These are the app-side mirror of `has_role()` in the database. The database
 * is the one that enforces; this exists so the UI can decide what to draw
 * without asking, and so the question is written once instead of as an
 * `includes` scattered over twenty files.
 *
 * **What is NOT here on purpose:** `active`. `has_role()` in the database folds
 * it in because a policy has one shot at the answer, but up here the profile is
 * already loaded and the two questions stay separate — a deactivated user is
 * not "roleless", they are inactive, and `/pending-access` needs to tell them
 * which one it is.
 */

/** Display order, and the order the checkboxes are drawn in. */
export const ROLE_ORDER: readonly UserRole[] = ["admin", "pm", "developer"] as const;

/** UI vocabulary, never the database's (`DESIGN.md` §11). */
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  pm: "PM",
  developer: "Developer",
};

export function hasRole(roles: UserRole[] | null | undefined, role: UserRole): boolean {
  return roles?.includes(role) ?? false;
}

export function isAdmin(roles: UserRole[] | null | undefined): boolean {
  return hasRole(roles, "admin");
}

export function isPm(roles: UserRole[] | null | undefined): boolean {
  return hasRole(roles, "pm");
}

export function isDeveloper(roles: UserRole[] | null | undefined): boolean {
  return hasRole(roles, "developer");
}

/**
 * `pm` sí, `developer` no. La respuesta a "¿quién esconde el calendario por
 * default?" (feature 014). Un `{pm, developer}` es dev y no cuenta como PM
 * puro — sigue apareciendo en la vista aunque el toggle esté off.
 */
export function isPmOnly(roles: UserRole[] | null | undefined): boolean {
  return hasRole(roles, "pm") && !hasRole(roles, "developer");
}

/** Whether the account is provisioned at all — the old `role !== null`. */
export function hasAnyRole(roles: UserRole[] | null | undefined): boolean {
  return (roles?.length ?? 0) > 0;
}

/** Sorted by `ROLE_ORDER` and deduped, mirroring the database trigger. */
export function sortRoles(roles: UserRole[]): UserRole[] {
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

/** `"Admin · PM"`, or null when there is nothing to show. */
export function formatRoles(roles: UserRole[] | null | undefined): string | null {
  if (!roles || roles.length === 0) return null;
  return sortRoles(roles)
    .map((role) => ROLE_LABEL[role])
    .join(" · ");
}
