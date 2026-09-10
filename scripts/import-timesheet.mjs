#!/usr/bin/env node
/**
 * Carga un CSV de timesheet (formato Timeneye / genérico) como bookings
 * históricos aprobados. Uso:
 *
 *   node scripts/import-timesheet.mjs --csv=docs/timesheet.csv
 *   node scripts/import-timesheet.mjs --csv=docs/timesheet.csv --commit
 *
 * Reglas (definidas con el usuario, 2026-09-09/10):
 *
 * - Se agregan las horas por (dev, cliente, proyecto, día calendario local).
 * - Cada agregado es un bloque contiguo que arranca a las 09:00 GMT-03:00 del
 *   día y dura la suma de horas trabajadas ese día en ese proyecto. Si el mismo
 *   dev tuvo múltiples proyectos ese día, se apilan uno detrás del otro en el
 *   orden cronológico en que aparecieron en el CSV.
 * - Status = 'approved' (histórico consolidado). `service_role` puede sembrar
 *   directo.
 * - Match exacto por nombre, con la tabla de alias y creaciones de MAPPINGS.
 *   Todo lo que quede sin match sale al reporte MD.
 * - Por default es dry-run. `--commit` aplica creaciones y luego inserta.
 *
 * Va con `service_role` sobre el mismo proyecto que sirve el deploy — igual
 * criterio que `cleanup-test-data.mjs`. No hay entornos separados.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  }),
);

const csvPath = args.get("csv");
const commit = args.get("commit") === "true";
if (!csvPath) fail("Falta --csv=<path>.");

const csvAbs = path.resolve(ROOT, csvPath);
if (!fs.existsSync(csvAbs)) fail(`No existe el CSV: ${csvAbs}`);

const env = parseEnv(fs.readFileSync(path.join(ROOT, ".env.local")));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) fail("Faltan credenciales en .env.local.");

const restHeaders = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function pgGet(pathAndQuery) {
  const r = await fetch(`${URL_}/rest/v1/${pathAndQuery}`, { headers: restHeaders });
  if (!r.ok) fail(`GET ${pathAndQuery} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function pgInsert(table, rows) {
  const r = await fetch(`${URL_}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  const body = await r.text();
  if (!r.ok) fail(`INSERT ${table} → ${r.status} ${body}`);
  return JSON.parse(body);
}

async function pgPatch(table, filter, body) {
  const r = await fetch(`${URL_}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...restHeaders, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) fail(`PATCH ${table}?${filter} → ${r.status} ${text}`);
  return JSON.parse(text);
}

async function authAdminCreateUser(email) {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST",
    headers: restHeaders,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const text = await r.text();
  if (!r.ok) fail(`CREATE user ${email} → ${r.status} ${text}`);
  return JSON.parse(text);
}

// ─────────────── MAPPINGS ───────────────
// Resueltos con el usuario. Cambiar acá si aparecen nuevos casos.
const MAPPINGS = {
  // full_name del CSV → email del profile en la DB (para mapear sin renombrar).
  // Además: si el profile en DB tiene otro full_name, se le PATCHea al que
  // usa el CSV (más consistente para futuras corridas). Solo se aplica si
  // `patchProfileName` es true.
  userAliases: [
    { csvName: "Cristian Alegre", email: "cris@wedoweb.co", patchProfileName: true },
  ],

  // Usuarios que hay que crear si no existen (por email). Después de crear,
  // se PATCHea `full_name` y `roles`.
  usersToCreate: [
    { csvName: "Pedro Gimenez", email: "pedro@wedoweb.co", roles: ["pm"] },
  ],

  // Clientes del CSV que hay que renombrar antes de buscar en la DB.
  clientAliases: {
    "Shakespear Works": "Shakespear",
    "Evolve Global Marketing": "EE Reed East",
  },

  // Proyectos del CSV que hay que renombrar antes de buscar en la DB.
  // Clave: `${clienteCanónico}||${proyectoCSV}` → nombre canónico en la DB.
  projectAliases: {
    "Outcomes Rocket||Outcomes Rocket Site": "OR Site",
    "Outcomes Rocket||Retia Medical": "Retia",
    "iLoan||iLoan New Site": "iLoan WP",
    "EE Reed East||EE Reed East": "General",
  },

  // Pares (clienteCanónico, proyectoCSV) que se saltean explícitamente
  // (no se crean, no se importan, van al reporte).
  projectSkips: new Set([
    "Shakespear||CFA", // el CFA real vive bajo Colegio Franco.
  ]),

  // Clientes a crear si no existen.
  clientsToCreate: ["WeDoWeb"],

  // Auto-crear proyectos que no existan: PM primario asignado a este email.
  autoCreateProjects: true,
  autoCreateProjectPmEmail: "brenda@wedoweb.co",
};

// ───────────────────────── CSV parser ─────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync(csvAbs, "utf8");
const csvRows = parseCsv(raw);
const header = csvRows.shift();
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
for (const r of ["Client", "Project", "User", "Start date", "Duration"]) {
  if (!(r in col)) fail(`Falta columna en el CSV: ${r}`);
}

function parseTimestamp(s) {
  const m = (s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MM, SS] = m;
  return {
    date: `${yyyy}-${mm}-${dd}`,
    seconds: Number(HH) * 3600 + Number(MM) * 60 + Number(SS),
  };
}
function parseDuration(s) {
  const parts = (s ?? "").trim().split(":");
  if (parts.length !== 3) return 0;
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

const entries = [];
for (const r of csvRows) {
  if (r.length < header.length) continue;
  const client = (r[col.Client] || "").trim();
  const project = (r[col.Project] || "").trim();
  const user = (r[col.User] || "").trim();
  const start = parseTimestamp(r[col["Start date"]]);
  const durationSec = parseDuration(r[col.Duration]);
  if (!user || !start || durationSec === 0) continue;
  entries.push({ user, client, project, date: start.date, startSec: start.seconds, durationSec });
}

// ─────────────── Agregación por (user, client, project, date) ───────────────
const aggregates = new Map();
for (const e of entries) {
  const key = `${e.user}||${e.client}||${e.project}||${e.date}`;
  const prev = aggregates.get(key);
  if (prev) {
    prev.totalSec += e.durationSec;
    prev.earliestSec = Math.min(prev.earliestSec, e.startSec);
  } else {
    aggregates.set(key, {
      user: e.user, client: e.client, project: e.project, date: e.date,
      totalSec: e.durationSec, earliestSec: e.startSec,
    });
  }
}

// ─────────────── Fetch DB (estado inicial) ───────────────
let [profiles, clients, projects] = await Promise.all([
  pgGet("profiles?select=id,full_name,email,roles,active"),
  pgGet("clients?select=id,name,active"),
  pgGet("projects?select=id,name,client_id,active"),
]);

// ─────────────── Setup: creaciones y updates planificados ───────────────
const plan = {
  profileUpdates: [], // { id, email, from, to }
  usersToCreate: [], // { email, csvName, roles }
  clientsToCreate: [], // { name }
  projectsToCreate: [], // { name, clientName }
};

// A) Profile updates (renombres de full_name para alias).
for (const alias of MAPPINGS.userAliases) {
  if (!alias.patchProfileName) continue;
  const p = profiles.find((x) => x.email === alias.email);
  if (p && p.full_name !== alias.csvName) {
    plan.profileUpdates.push({ id: p.id, email: p.email, from: p.full_name, to: alias.csvName });
  }
}

// B) Usuarios a crear.
for (const spec of MAPPINGS.usersToCreate) {
  const existing = profiles.find((p) => p.email === spec.email);
  if (!existing) plan.usersToCreate.push(spec);
}

// C) Clientes a crear.
for (const name of MAPPINGS.clientsToCreate) {
  if (!clients.some((c) => c.name === name)) plan.clientsToCreate.push({ name });
}

// D) Proyectos: se resuelven después de aplicar alias, en la fase de matching.
//    Los cargamos acá provisoriamente en `pendingProjects` y los promovemos.
const pendingProjects = new Set(); // `${clientCanónico}||${projName}`
function projectExistsOrPending(clientName, projectName) {
  const client = clients.find((c) => c.name === clientName);
  const clientId = client?.id;
  if (clientId && projects.some((p) => p.client_id === clientId && p.name === projectName)) return true;
  if (pendingProjects.has(`${clientName}||${projectName}`)) return true;
  // Cliente pendiente de creación → proyecto también pendiente.
  if (plan.clientsToCreate.some((c) => c.name === clientName)) {
    return pendingProjects.has(`${clientName}||${projectName}`);
  }
  return false;
}

// ─────────────── Matching ───────────────
const matched = [];
const unmatched = { user: new Map(), project: new Map(), other: [] };

const userAliasByCsvName = new Map(MAPPINGS.userAliases.map((a) => [a.csvName, a.email]));
const usersToCreateByCsvName = new Map(MAPPINGS.usersToCreate.map((s) => [s.csvName, s]));

function resolveUser(csvName) {
  const email = userAliasByCsvName.get(csvName);
  if (email) {
    const p = profiles.find((x) => x.email === email);
    return p ? { kind: "existing", profile: p } : { kind: "unknown" };
  }
  const spec = usersToCreateByCsvName.get(csvName);
  if (spec) {
    const existing = profiles.find((p) => p.email === spec.email);
    if (existing) return { kind: "existing", profile: existing };
    return { kind: "pending", spec };
  }
  const byName = profiles.find((p) => p.full_name === csvName);
  return byName ? { kind: "existing", profile: byName } : { kind: "missing" };
}

function resolveClientName(csvClient) {
  return MAPPINGS.clientAliases[csvClient] ?? csvClient;
}
function resolveProjectName(canonicalClient, csvProject) {
  return MAPPINGS.projectAliases[`${canonicalClient}||${csvProject}`] ?? csvProject;
}

for (const agg of aggregates.values()) {
  if (!agg.client || !agg.project) {
    unmatched.other.push({ agg, reason: "cliente o proyecto vacío en CSV" });
    continue;
  }
  const userRes = resolveUser(agg.user);
  if (userRes.kind === "missing" || userRes.kind === "unknown") {
    const key = agg.user;
    const b = unmatched.user.get(key) ?? { entries: 0, hours: 0 };
    b.entries++;
    b.hours += agg.totalSec / 3600;
    unmatched.user.set(key, b);
    continue;
  }

  const canonicalClient = resolveClientName(agg.client);
  const canonicalProject = resolveProjectName(canonicalClient, agg.project);
  if (MAPPINGS.projectSkips.has(`${canonicalClient}||${canonicalProject}`)) {
    const key = `${agg.client} › ${agg.project}` +
      (canonicalClient !== agg.client || canonicalProject !== agg.project
        ? ` (→ ${canonicalClient} › ${canonicalProject})` : "");
    const b = unmatched.project.get(key) ?? { entries: 0, hours: 0, reason: "skip explícito" };
    b.entries++;
    b.hours += agg.totalSec / 3600;
    unmatched.project.set(key, b);
    continue;
  }
  const clientExists =
    clients.some((c) => c.name === canonicalClient) ||
    plan.clientsToCreate.some((c) => c.name === canonicalClient);
  if (!clientExists) {
    // Con la política actual del usuario, cliente inexistente NO se auto-crea
    // (solo se crea WeDoWeb). Va al reporte.
    const key = `${agg.client} › ${agg.project}` +
      (canonicalClient !== agg.client ? ` (→ ${canonicalClient})` : "");
    const b = unmatched.project.get(key) ?? { entries: 0, hours: 0, reason: `cliente '${canonicalClient}' no existe` };
    b.entries++;
    b.hours += agg.totalSec / 3600;
    unmatched.project.set(key, b);
    continue;
  }

  if (!projectExistsOrPending(canonicalClient, canonicalProject)) {
    if (MAPPINGS.autoCreateProjects) {
      pendingProjects.add(`${canonicalClient}||${canonicalProject}`);
      plan.projectsToCreate.push({ name: canonicalProject, clientName: canonicalClient });
    } else {
      const key = `${agg.client} › ${agg.project}`;
      const b = unmatched.project.get(key) ?? { entries: 0, hours: 0, reason: "proyecto no existe" };
      b.entries++;
      b.hours += agg.totalSec / 3600;
      unmatched.project.set(key, b);
      continue;
    }
  }
  matched.push({ agg, userRes, canonicalClient, canonicalProject });
}

// ─────────────── created_by ───────────────
const adminForCreatedBy =
  profiles.find((p) => p.email === "nico@wedoweb.co") ||
  profiles.find((p) => p.roles?.includes("admin"));
if (!adminForCreatedBy) fail("No encuentro un admin para poner en created_by.");

// ─────────────── PM primario para proyectos autocreados ───────────────
const autoCreatePm = profiles.find((p) => p.email === MAPPINGS.autoCreateProjectPmEmail);
if (plan.projectsToCreate.length > 0 && !autoCreatePm) {
  fail(`Necesito el PM ${MAPPINGS.autoCreateProjectPmEmail} para crear los proyectos nuevos.`);
}

// ─────────────── Reporte MD ───────────────
const md = [];
md.push(`# Import de timesheet — reporte`);
md.push(``);
md.push(`- **Archivo:** \`${csvPath}\``);
md.push(`- **Corrida:** ${new Date().toISOString()}`);
md.push(`- **Modo:** ${commit ? "COMMIT" : "dry-run"}`);
md.push(``);
md.push(`## Resumen`);
md.push(``);
md.push(`| | Cant. | Horas |`);
md.push(`|---|---:|---:|`);
const totalHoursCsv = entries.reduce((s, e) => s + e.durationSec, 0) / 3600;
const matchedHours = matched.reduce((s, m) => s + m.agg.totalSec, 0) / 3600;
const unmatchedUserHours = [...unmatched.user.values()].reduce((s, b) => s + b.hours, 0);
const unmatchedProjectHours = [...unmatched.project.values()].reduce((s, b) => s + b.hours, 0);
const otherHours = unmatched.other.reduce((s, o) => s + o.agg.totalSec / 3600, 0);
md.push(`| CSV agregado (dev·cliente·proyecto·día) | ${aggregates.size} | ${totalHoursCsv.toFixed(2)} |`);
md.push(`| → Matcheado a bookings | ${matched.length} | ${matchedHours.toFixed(2)} |`);
md.push(`| → Sin match por usuario | ${[...unmatched.user.values()].reduce((s, b) => s + b.entries, 0)} | ${unmatchedUserHours.toFixed(2)} |`);
md.push(`| → Sin match por proyecto/cliente | ${[...unmatched.project.values()].reduce((s, b) => s + b.entries, 0)} | ${unmatchedProjectHours.toFixed(2)} |`);
md.push(`| → Filas ambiguas (sin cliente o proyecto) | ${unmatched.other.length} | ${otherHours.toFixed(2)} |`);
md.push(``);
md.push(`## Cambios planificados en la DB`);
md.push(``);
md.push(`**Perfiles a actualizar (renombre):**`);
md.push(``);
if (plan.profileUpdates.length === 0) md.push(`_(ninguno)_`);
else {
  md.push(`| Email | full_name antes | full_name después |`);
  md.push(`|---|---|---|`);
  plan.profileUpdates.forEach((u) => md.push(`| ${u.email} | ${u.from} | ${u.to} |`));
}
md.push(``);
md.push(`**Usuarios a crear:**`);
md.push(``);
if (plan.usersToCreate.length === 0) md.push(`_(ninguno)_`);
else {
  md.push(`| Email | Nombre | Roles |`);
  md.push(`|---|---|---|`);
  plan.usersToCreate.forEach((s) => md.push(`| ${s.email} | ${s.csvName} | ${s.roles.join(", ")} |`));
  md.push(``);
  md.push(`> Los emails son placeholders — si el email real de Google difiere, actualizarlo en \`profiles\` antes de que el usuario intente loguearse.`);
}
md.push(``);
md.push(`**Clientes a crear:**`);
md.push(``);
if (plan.clientsToCreate.length === 0) md.push(`_(ninguno)_`);
else {
  md.push(`| Nombre |`);
  md.push(`|---|`);
  plan.clientsToCreate.forEach((c) => md.push(`| ${c.name} |`));
}
md.push(``);
md.push(`**Proyectos a crear** (PM primario: ${autoCreatePm?.full_name ?? MAPPINGS.autoCreateProjectPmEmail}, prioridad: normal, active: true):`);
md.push(``);
if (plan.projectsToCreate.length === 0) md.push(`_(ninguno)_`);
else {
  md.push(`| Cliente | Proyecto |`);
  md.push(`|---|---|`);
  plan.projectsToCreate
    .sort((a, b) => (a.clientName + a.name).localeCompare(b.clientName + b.name))
    .forEach((p) => md.push(`| ${p.clientName} | ${p.name} |`));
}
md.push(``);
md.push(`## Sin match — usuarios`);
md.push(``);
if (unmatched.user.size === 0) md.push(`_(ninguno)_`);
else {
  md.push(`| Nombre CSV | Agregados | Horas |`);
  md.push(`|---|---:|---:|`);
  for (const [name, b] of [...unmatched.user.entries()].sort((a, b) => b[1].hours - a[1].hours)) {
    md.push(`| ${name || "_(vacío)_"} | ${b.entries} | ${b.hours.toFixed(2)} |`);
  }
}
md.push(``);
md.push(`## Sin match — proyectos / clientes`);
md.push(``);
if (unmatched.project.size === 0) md.push(`_(ninguno)_`);
else {
  md.push(`| Cliente › Proyecto (CSV) | Motivo | Agregados | Horas |`);
  md.push(`|---|---|---:|---:|`);
  for (const [name, b] of [...unmatched.project.entries()].sort((a, b) => b[1].hours - a[1].hours)) {
    md.push(`| ${name} | ${b.reason} | ${b.entries} | ${b.hours.toFixed(2)} |`);
  }
}
md.push(``);
md.push(`## Filas ambiguas (sin cliente o proyecto en el CSV)`);
md.push(``);
if (unmatched.other.length === 0) md.push(`_(ninguno)_`);
else {
  md.push(`| Usuario | Fecha | Horas | Motivo |`);
  md.push(`|---|---|---:|---|`);
  unmatched.other.forEach((o) => md.push(`| ${o.agg.user} | ${o.agg.date} | ${(o.agg.totalSec / 3600).toFixed(2)} | ${o.reason} |`));
}
md.push(``);
md.push(`## Matcheado — horas por dev/PM`);
md.push(``);
md.push(`| Persona | Días | Bloques | Horas |`);
md.push(`|---|---:|---:|---:|`);
const perUser = new Map();
for (const m of matched) {
  const name = m.agg.user;
  const b = perUser.get(name) ?? { days: new Set(), blocks: 0, secs: 0 };
  b.days.add(m.agg.date);
  b.blocks++;
  b.secs += m.agg.totalSec;
  perUser.set(name, b);
}
for (const [name, b] of [...perUser.entries()].sort((a, b) => b[1].secs - a[1].secs)) {
  md.push(`| ${name} | ${b.days.size} | ${b.blocks} | ${(b.secs / 3600).toFixed(2)} |`);
}
md.push(``);
md.push(`## Matcheado — horas por proyecto`);
md.push(``);
md.push(`| Cliente | Proyecto | Bloques | Horas |`);
md.push(`|---|---|---:|---:|`);
const perProject = new Map();
for (const m of matched) {
  const key = `${m.canonicalClient}||${m.canonicalProject}`;
  const b = perProject.get(key) ?? { blocks: 0, secs: 0 };
  b.blocks++;
  b.secs += m.agg.totalSec;
  perProject.set(key, b);
}
for (const [key, b] of [...perProject.entries()].sort((a, b) => b[1].secs - a[1].secs)) {
  const [cli, proj] = key.split("||");
  md.push(`| ${cli} | ${proj} | ${b.blocks} | ${(b.secs / 3600).toFixed(2)} |`);
}
md.push(``);

const mdPath = path.join(ROOT, "docs/timesheet-import-report.md");
fs.writeFileSync(mdPath, md.join("\n"));

// ─────────────── Consola ───────────────
console.log(`\n=== Resumen ===`);
console.log(`  Entradas CSV: ${entries.length}`);
console.log(`  Agregados: ${aggregates.size}`);
console.log(`  Horas totales CSV: ${totalHoursCsv.toFixed(2)}`);
console.log(`  → Matcheado: ${matched.length} bloques (${matchedHours.toFixed(2)}h)`);
console.log(`  → Sin match usuario: ${unmatchedUserHours.toFixed(2)}h`);
console.log(`  → Sin match proyecto: ${unmatchedProjectHours.toFixed(2)}h`);
console.log(`  → Ambiguas: ${otherHours.toFixed(2)}h`);
console.log(`\nCambios planificados:`);
console.log(`  Perfiles a renombrar: ${plan.profileUpdates.length}`);
console.log(`  Usuarios a crear: ${plan.usersToCreate.length}`);
console.log(`  Clientes a crear: ${plan.clientsToCreate.length}`);
console.log(`  Proyectos a crear: ${plan.projectsToCreate.length}`);
console.log(`\nReporte: docs/timesheet-import-report.md`);
console.log(`created_by: ${adminForCreatedBy.full_name} <${adminForCreatedBy.email}>`);

if (!commit) {
  console.log(`\n(dry-run — no se escribió a la DB. Pasar --commit para aplicar.)\n`);
  process.exit(0);
}

// ─────────────── COMMIT ───────────────
console.log(`\n=== APLICANDO CAMBIOS ===\n`);

// 1. Profile updates.
for (const u of plan.profileUpdates) {
  await pgPatch("profiles", `id=eq.${u.id}`, { full_name: u.to });
  console.log(`  ✓ profile ${u.email}: '${u.from}' → '${u.to}'`);
}

// 2. Crear usuarios (auth admin) y patch de full_name + roles.
for (const spec of plan.usersToCreate) {
  const authUser = await authAdminCreateUser(spec.email);
  console.log(`  ✓ auth user creado ${spec.email} (${authUser.id})`);
  // El trigger handle_new_user() crea la fila de profiles sincrónicamente.
  await pgPatch("profiles", `id=eq.${authUser.id}`, {
    full_name: spec.csvName,
    roles: spec.roles,
    active: true,
  });
  console.log(`  ✓ profile actualizado ${spec.csvName} [${spec.roles.join(",")}]`);
}

// 3. Crear clientes.
for (const c of plan.clientsToCreate) {
  const [row] = await pgInsert("clients", [{ name: c.name }]);
  console.log(`  ✓ cliente creado ${row.name} (${row.id})`);
}

// Re-fetch después de creaciones.
[profiles, clients, projects] = await Promise.all([
  pgGet("profiles?select=id,full_name,email,roles,active"),
  pgGet("clients?select=id,name,active"),
  pgGet("projects?select=id,name,client_id,active"),
]);

// 4. Crear proyectos.
const brendaAfterFetch = profiles.find((p) => p.email === MAPPINGS.autoCreateProjectPmEmail);
for (const p of plan.projectsToCreate) {
  const client = clients.find((c) => c.name === p.clientName);
  if (!client) fail(`Cliente '${p.clientName}' no encontrado tras creación.`);
  const [row] = await pgInsert("projects", [{
    name: p.name,
    client_id: client.id,
    pm_id: brendaAfterFetch.id,
    priority: "normal",
    active: true,
  }]);
  console.log(`  ✓ proyecto creado ${p.clientName} › ${row.name}`);
}

// Re-fetch proyectos con los recién creados.
projects = await pgGet("projects?select=id,name,client_id,active");

// 5. Construir bookings y apilar por (dev, día) desde 09:00.
function isoLocal(dateYMD, seconds) {
  const hh = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const mm = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${dateYMD}T${hh}:${mm}:${ss}-03:00`;
}

const resolvedMatched = matched.map((m) => {
  let profile;
  if (m.userRes.kind === "existing") profile = m.userRes.profile;
  else if (m.userRes.kind === "pending") {
    profile = profiles.find((p) => p.email === m.userRes.spec.email);
    if (!profile) fail(`Profile del usuario recién creado ${m.userRes.spec.email} no encontrado.`);
  }
  const client = clients.find((c) => c.name === m.canonicalClient);
  const project = projects.find((p) => p.client_id === client.id && p.name === m.canonicalProject);
  if (!project) fail(`Proyecto ${m.canonicalClient} › ${m.canonicalProject} no encontrado tras creación.`);
  return { ...m, profile, project };
});

const byDevDay = new Map();
for (const m of resolvedMatched) {
  const key = `${m.profile.id}||${m.agg.date}`;
  const list = byDevDay.get(key) ?? [];
  list.push(m);
  byDevDay.set(key, list);
}

const bookingsToInsert = [];
for (const list of byDevDay.values()) {
  list.sort((a, b) => a.agg.earliestSec - b.agg.earliestSec);
  const date = list[0].agg.date;
  let cursorSec = 9 * 3600;
  for (const m of list) {
    const startSec = cursorSec;
    const endSec = cursorSec + m.agg.totalSec;
    cursorSec = endSec;
    bookingsToInsert.push({
      project_id: m.project.id,
      dev_id: m.profile.id,
      created_by: adminForCreatedBy.id,
      starts_at: isoLocal(date, startSec),
      ends_at: isoLocal(date, endSec),
      status: "approved",
      note: `[import:timesheet-2026-08] agregado ${(m.agg.totalSec / 3600).toFixed(2)}h`,
    });
  }
}

console.log(`\nInsertando ${bookingsToInsert.length} bookings...`);
const CHUNK = 100;
let inserted = 0;
for (let i = 0; i < bookingsToInsert.length; i += CHUNK) {
  const chunk = bookingsToInsert.slice(i, i + CHUNK);
  const res = await pgInsert("bookings", chunk);
  inserted += res.length;
  console.log(`  ${inserted}/${bookingsToInsert.length}`);
}
console.log(`\n✓ Insertados ${inserted} bookings.\n`);
