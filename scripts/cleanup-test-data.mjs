#!/usr/bin/env node
/**
 * Borra los datos de UNA prueba manual sobre el proyecto remoto de desarrollo.
 *
 *   node scripts/cleanup-test-data.mjs --run-id=local-a1b2c3d4
 *   node scripts/cleanup-test-data.mjs --run-id=local-a1b2c3d4 --dry-run
 *
 * Este es el único camino por el que tocamos el proyecto alojado, y por eso es
 * el más desconfiado del repo:
 *
 * - **Exige un identificador de corrida válido.** Sin él no hace nada. Un
 *   borrado "de lo de test" sin identificador es un borrado a secas.
 * - **Filtra por el prefijo exacto de esa corrida**, nunca por algo tan amplio
 *   como "todo lo que diga test". Otra corrida en curso no se toca.
 * - **Va de hijos a padres**, porque las FK de `projects` son `on delete
 *   restrict`: primero reservas y auditoría, después proyectos, después
 *   clientes, y al final los usuarios de auth.
 * - Nunca trunca ni borra por filtros abiertos.
 *
 * Los tests automáticos NO usan esto: corren contra el stack efímero de CI, que
 * se descarta entero al terminar el job. Ver `docs/testing.md`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parse } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Mismo formato que `TEST_RUN_ID` en `tests/run-id.ts`. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{3,}$/;

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);

const runId = args.get("run-id");
const dryRun = args.get("dry-run") === "true";

if (!runId || !RUN_ID_PATTERN.test(runId)) {
  fail(
    "Falta --run-id, o no tiene un formato válido.\n\n" +
      "  node scripts/cleanup-test-data.mjs --run-id=local-a1b2c3d4\n\n" +
      "El identificador es obligatorio a propósito: sin él esto sería un borrado " +
      "sin límites sobre la base de desarrollo.",
  );
}

// Credenciales del proyecto remoto de desarrollo. Es el opuesto exacto de
// `tests/env.ts`, que rechaza cualquier URL que no sea local: acá el destino
// remoto es el punto, y por eso todo lo demás es tan restrictivo.
const env = (() => {
  try {
    return parse(fs.readFileSync(path.join(ROOT, ".env.local")));
  } catch {
    return fail("No se pudo leer .env.local. Es de donde salen las credenciales.");
  }
})();

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const namePrefix = `[test:${runId}]`;
const emailPrefix = `test-${runId}-`;

// `%` solo al final: es un prefijo, no una búsqueda por contenido.
const nameFilter = `${namePrefix}%`;
const emailFilter = `${emailPrefix}%`;

console.log(`\nProyecto : ${url}`);
console.log(`Corrida  : ${runId}`);
console.log(`Nombres  : ${namePrefix} …`);
console.log(`Emails   : ${emailPrefix}…`);
if (dryRun) console.log("\n(dry-run: no se borra nada)\n");

async function main() {
  const { data: projects, error: projectsError } = await admin
    .from("projects")
    .select("id, name")
    .like("name", nameFilter);
  if (projectsError) fail(`No se pudieron listar los proyectos: ${projectsError.message}`);

  const { data: clients, error: clientsError } = await admin
    .from("clients")
    .select("id, name")
    .like("name", nameFilter);
  if (clientsError) fail(`No se pudieron listar los clientes: ${clientsError.message}`);

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, email")
    .like("email", emailFilter);
  if (profilesError) fail(`No se pudieron listar los perfiles: ${profilesError.message}`);

  const projectIds = (projects ?? []).map((row) => row.id);
  const clientIds = (clients ?? []).map((row) => row.id);
  const profileIds = (profiles ?? []).map((row) => row.id);

  console.log(
    `\nEncontrado: ${projectIds.length} proyectos · ${clientIds.length} clientes · ` +
      `${profileIds.length} usuarios`,
  );

  if (projectIds.length + clientIds.length + profileIds.length === 0) {
    console.log("\nNada que borrar para esa corrida.\n");
    return;
  }

  if (dryRun) {
    for (const row of projects ?? []) console.log(`  proyecto  ${row.name}`);
    for (const row of clients ?? []) console.log(`  cliente   ${row.name}`);
    for (const row of profiles ?? []) console.log(`  usuario   ${row.email}`);
    console.log();
    return;
  }

  // ── Hijos primero ─────────────────────────────────────────────────────────
  // Las reservas cuelgan del proyecto y del desarrollador, y las dos FK son
  // `restrict`: si queda una sola reserva, el borrado del padre falla.
  if (projectIds.length > 0) {
    const { error } = await admin.from("bookings").delete().in("project_id", projectIds);
    if (error) fail(`No se pudieron borrar las reservas: ${error.message}`);
  }
  if (profileIds.length > 0) {
    const { error } = await admin.from("bookings").delete().in("dev_id", profileIds);
    if (error) fail(`No se pudieron borrar las reservas del dev: ${error.message}`);
  }

  if (projectIds.length > 0) {
    // `audit_log` referencia la entidad por id, sin FK: si no se limpia queda
    // apuntando a un proyecto que ya no existe.
    const { error } = await admin.from("audit_log").delete().in("entity_id", projectIds);
    if (error) fail(`No se pudo limpiar audit_log: ${error.message}`);

    const { error: projectError } = await admin
      .from("projects")
      .delete()
      .in("id", projectIds);
    if (projectError) fail(`No se pudieron borrar los proyectos: ${projectError.message}`);
  }

  if (clientIds.length > 0) {
    const { error } = await admin.from("clients").delete().in("id", clientIds);
    if (error) fail(`No se pudieron borrar los clientes: ${error.message}`);
  }

  // Los usuarios van al final: `profiles` cuelga de `auth.users` con cascade, y
  // borrar el usuario se lleva el perfil.
  for (const profile of profiles ?? []) {
    const { error } = await admin.auth.admin.deleteUser(profile.id);
    if (error) console.warn(`  ! no se pudo borrar ${profile.email}: ${error.message}`);
  }

  // Las invitaciones no dejan perfil si nadie las consumió.
  const { error: inviteError } = await admin
    .from("profile_invites")
    .delete()
    .like("email", emailFilter);
  if (inviteError) console.warn(`  ! profile_invites: ${inviteError.message}`);

  console.log("\n✓ Listo. Solo se borraron registros de esa corrida.\n");
}

main().catch((error) => fail(error?.message ?? String(error)));
