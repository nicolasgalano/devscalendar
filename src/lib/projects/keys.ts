/**
 * Derivar `projects.key` a partir del nombre del proyecto, con el MISMO
 * algoritmo que el backfill de la migration 14. Vive acá para que el handler
 * de creación de proyectos y los helpers de test compartan el criterio con la
 * base — cualquier deriva entre este archivo y el SQL del backfill hace que
 * un mismo nombre produzca claves distintas según quién lo cree.
 *
 * SQL equivalente:
 *   upper(substring(regexp_replace(name, '[^A-Za-z]', '', 'g') from 1 for 6))
 *   con fallback 'PROJ' si el resultado queda vacío o de menos de 2 chars
 *   (el check constraint exige [A-Z][A-Z0-9]{1,7}, o sea al menos 2 chars).
 *
 * Hasta que T8.1 agregue el input explícito de `key` en el form de admin,
 * esta función es la única fuente de `key` en la app. Cuando exista el input,
 * se sigue usando como sugerencia por defecto en el form y como fallback si
 * el usuario deja el campo vacío.
 */
export function deriveProjectKey(name: string): string {
  const cleaned = name.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase();
  return cleaned.length >= 2 ? cleaned : "PROJ";
}
