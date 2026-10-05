import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 021 — Guardrail del rename "Actividad" → "Tarea" en UI.
 *
 * El rename es cosmético: en la base la tabla sigue siendo `project_activities`
 * y los identificadores de código (`activityId`, `activity_id`, etc.) se
 * conservan. Lo que no puede quedar es un texto visible al usuario con la
 * palabra vieja. Este test recorre `src/components/` y `src/app/` buscando
 * `\bactividad(es)?\b` en el código fuente (sin comentarios) y falla ruidoso
 * si aparece.
 *
 * **Solo `.tsx`.** Las rutas API bajo `src/app/api/` son `.ts`, exclusión
 * deliberada: los strings de error de API no son UI directa y el plan de
 * 021 los deja afuera del rename.
 *
 * **`EXCLUSION_LIST` empieza vacía.** Si aparece un match legítimo (p.ej.
 * un string dinámico que casualmente contiene la palabra en otro contexto),
 * agregá el path acá con un comentario del PR explicando por qué.
 */
const EXCLUSION_LIST: string[] = [];

const UI_ROOTS = ["src/components", "src/app"];
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PATTERN = /\bactividad(es)?\b/i;

type Violation = { file: string; line: number; text: string };

function walkTsx(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walkTsx(full, out);
    } else if (stats.isFile() && full.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

function stripComments(source: string): string {
  // Orden importa: primero bloques (`/* ... */`), después línea (`// ...`).
  // No es un parser de JS/TS — un `//` dentro de un string regular podría
  // falsear, pero en la práctica del repo los únicos matches posibles están
  // en código real o en comentarios reales (los string literals con URLs ya
  // son excepción documentada en la comment-stripping de la mayoría de
  // guardrails similares).
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("021 · rename Actividad → Tarea", () => {
  it("ningún archivo .tsx bajo src/components o src/app contiene 'actividad' visible", () => {
    const files: string[] = [];
    for (const root of UI_ROOTS) {
      walkTsx(path.join(REPO_ROOT, root), files);
    }

    const violations: Violation[] = [];

    for (const absolute of files) {
      const relative = path.relative(REPO_ROOT, absolute);
      if (EXCLUSION_LIST.includes(relative)) continue;

      const source = readFileSync(absolute, "utf-8");
      const stripped = stripComments(source);
      if (!PATTERN.test(stripped)) continue;

      // Rearmar contexto por línea para el reporte de error.
      const strippedLines = stripped.split("\n");
      const originalLines = source.split("\n");
      for (let i = 0; i < strippedLines.length; i++) {
        if (PATTERN.test(strippedLines[i]!)) {
          violations.push({
            file: relative,
            line: i + 1,
            text: (originalLines[i] ?? strippedLines[i]!).trim(),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
