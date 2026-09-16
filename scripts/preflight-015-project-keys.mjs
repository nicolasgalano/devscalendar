#!/usr/bin/env node
/**
 * Pre-flight de la migration 015 (project_membership_and_tickets).
 *
 *   node scripts/preflight-015-project-keys.mjs
 *
 * La migration agrega `projects.key varchar(8)` con constraint `unique` y hace
 * un backfill derivado del nombre. Antes de correrla en la base productiva hay
 * que garantizar que dos proyectos no van a colisionar en la misma `key` —
 * si ocurre, el `alter table ... add constraint ... unique` falla y la
 * migration queda a medias. Ver plan.md §3.2 y R-2.
 *
 * Este script hace SOLO lectura sobre `projects` vía PostgREST. No modifica
 * nada. Usa `fetch` directo (no supabase-js) porque supabase-js inicializa
 * Realtime y necesita WebSocket nativo (Node 22+); un pre-flight read-only
 * no vale otro Node version.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const env = (() => {
  try {
    return parse(fs.readFileSync(path.join(ROOT, ".env.local")));
  } catch {
    return fail("No se pudo leer .env.local.");
  }
})();

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
}

console.log(`\nProyecto: ${url}\n`);

const response = await fetch(`${url}/rest/v1/projects?select=id,name,active&order=name.asc`, {
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});

if (!response.ok) {
  fail(`Fetch falló con ${response.status}: ${await response.text()}`);
}

const projects = await response.json();

// Misma lógica que el backfill de la migration:
//   upper(substring(regexp_replace(name, '[^A-Za-z]', '', 'g') from 1 for 6))
//   con fallback 'PROJ'.
function keyFromName(name) {
  const cleaned = name.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase();
  return cleaned || "PROJ";
}

const groups = new Map();
for (const project of projects) {
  const key = keyFromName(project.name);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(project);
}

console.log(`Total proyectos    : ${projects.length}`);
console.log(`Keys candidatas    : ${groups.size}`);

const collisions = [...groups].filter(([, list]) => list.length > 1);
console.log(`Colisiones         : ${collisions.length}\n`);

if (projects.length > 0) {
  console.log("Todas las keys candidatas:\n");
  for (const [key, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const marker = list.length > 1 ? "✗" : "·";
    console.log(`  ${marker} ${key.padEnd(8)} → ${list.map((p) => p.name).join(", ")}`);
  }
  console.log("");
}

if (collisions.length === 0) {
  console.log("✓ Sin colisiones — la migration puede correr sin cambios previos.\n");
  process.exit(0);
}

console.log("Detalle de colisiones (habría que renombrar uno de cada grupo):\n");
for (const [key, list] of collisions) {
  console.log(`  ${key}`);
  for (const p of list) {
    const state = p.active ? "activo" : "inactivo";
    console.log(`    · ${p.name} (${state}) — ${p.id}`);
  }
}
console.log("");
process.exit(1);
