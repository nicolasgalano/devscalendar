/**
 * Feature 029: constantes compartidas entre `/calendar?view=planning` (011)
 * y `/planning` (029). Extraídas acá para que una no divergir de la otra sin
 * querer — si alguien cambia `PLANNING_CELL_WIDTH`, cambia en los dos.
 *
 * El acuerdo visual original viene de DESIGN.md §5 + 011/plan.md §7.1:
 * celdas compactas para que 4 semanas (28 días) + el label de la izquierda
 * entren en una pantalla de 1280px sin scroll horizontal.
 */

export const PLANNING_CELL_WIDTH = 40;
export const PLANNING_LABEL_WIDTH = 240;
export const PLANNING_ROW_HEIGHT = 36;

export const PLANNING_WEEK_SIZE = 7;
export const PLANNING_VISIBLE_WEEKS = 4;
export const PLANNING_VISIBLE_DAYS = PLANNING_WEEK_SIZE * PLANNING_VISIBLE_WEEKS;
