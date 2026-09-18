#!/usr/bin/env -S pnpm exec tsx
/**
 * Migración one-shot de descripciones de tickets (feature 019).
 *
 * Lee `tickets.description` (markdown viejo) para todo ticket que aún tenga
 * `description_doc = null`, lo convierte con `markdownToProseMirrorDoc` a un
 * doc de ProseMirror que respeta `RICH_TEXT_SCHEMA`, lo valida, y escribe
 * el resultado en `description_doc`. Solo escribe; **no** modifica la columna
 * markdown vieja — ese drop llega en fase 2 (feature aparte).
 *
 * Uso:
 *
 *   pnpm exec tsx scripts/migrate-ticket-descriptions.ts --dry-run
 *   pnpm exec tsx scripts/migrate-ticket-descriptions.ts --limit 5
 *   pnpm exec tsx scripts/migrate-ticket-descriptions.ts
 *
 * Flags:
 *   --dry-run   No escribe. Reporta cuántos convertiría y muestra los 5
 *               primeros diffs (`key` + doc convertido).
 *   --limit N   Procesa a lo sumo N tickets. Útil para pruebas escalonadas.
 *
 * Este script se corre **una sola vez** contra el proyecto Supabase después
 * de aplicar la migration 19 y antes (o después) de deployar el código de
 * 019. La app funciona sin que este script haya corrido: los tickets no
 * migrados caen al fallback de `<MarkdownViewer>` en el detalle, y si el
 * usuario los edita, la conversión al vuelo (misma función) los pasa a rich
 * text al guardar. Este script simplemente cierra ese loop de una y evita
 * que los tickets viejos se queden mostrando el fallback para siempre.
 *
 * Loguea cada ticket que skipeó y por qué; el operador puede corregir a
 * mano después. Un ticket con markdown sintácticamente roto genera un doc
 * "mejor esfuerzo" (párrafo con el texto plano) — no se skipea, se guarda
 * como está.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { parse as parseEnv } from "dotenv";
import WebSocket from "ws";

import { markdownToProseMirrorDoc } from "../src/lib/editor/convert";
import { RICH_TEXT_SCHEMA } from "../src/lib/editor/schema";
import { validateProseMirrorDoc } from "../src/lib/editor/validate";
import type { Database } from "../src/types/database";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BATCH_SIZE = 100;
const DRY_RUN_PREVIEW_COUNT = 5;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const args = new Map<string, string>(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key!, rest.join("=") || "true"];
  }),
);

const dryRun = args.get("dry-run") === "true";
const limitRaw = args.get("limit");
const limit = limitRaw ? Number(limitRaw) : null;
if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
  fail("--limit debe ser un entero positivo");
}

const env = (() => {
  try {
    return parseEnv(fs.readFileSync(path.join(ROOT, ".env.local")));
  } catch {
    return fail("No se pudo leer .env.local. Es de donde salen las credenciales.");
  }
})();

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
}

const admin = createClient<Database>(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  // Node 20 no expone `WebSocket` global; el cliente de Supabase 2.x inicializa
  // el RealtimeClient siempre y tira si no lo encuentra. No usamos realtime,
  // pero inyectar `ws` acá es el fix más chico. Con Node 22+ se puede sacar.
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
});

console.log(`\nProyecto : ${url}`);
console.log(`Modo     : ${dryRun ? "dry-run (no escribe)" : "APLICA CAMBIOS"}`);
if (limit) console.log(`Límite   : ${limit} tickets`);
console.log();

type TicketRow = { id: string; numero: number; description: string; project_id: string };
type ProjectRow = { id: string; key: string };

async function main() {
  const { data: pending, error } = await admin
    .from("tickets")
    .select("id, numero, description, project_id")
    .not("description", "is", null)
    .is("description_doc", null)
    .limit(limit ?? 10_000);

  if (error) fail(`No se pudieron listar los tickets pendientes: ${error.message}`);
  const tickets = (pending ?? []).filter(
    (t): t is TicketRow => t.description !== null && t.description.trim().length > 0,
  );

  if (tickets.length === 0) {
    console.log("No hay tickets pendientes de migrar. Todo listo.");
    return;
  }

  console.log(`Encontrados: ${tickets.length} tickets con markdown y sin descriptionDoc.\n`);

  // Precargar proyectos para mostrar el key (`PROJ-N`) en los logs. La
  // performance no importa: es un script one-shot.
  const projectIds = Array.from(new Set(tickets.map((t) => t.project_id)));
  const { data: projectsData } = await admin
    .from("projects")
    .select("id, key")
    .in("id", projectIds);
  const projectByIdMap = new Map<string, ProjectRow>(
    (projectsData ?? []).map((p) => [p.id, p as ProjectRow]),
  );

  const stats = { converted: 0, skipped: 0, written: 0 };
  const previews: { key: string; docPreview: string }[] = [];

  for (let start = 0; start < tickets.length; start += BATCH_SIZE) {
    const batch = tickets.slice(start, start + BATCH_SIZE);

    for (const ticket of batch) {
      const project = projectByIdMap.get(ticket.project_id);
      const key = project ? `${project.key}-${ticket.numero}` : `?-${ticket.numero}`;

      const doc = markdownToProseMirrorDoc(ticket.description ?? "");
      const validation = validateProseMirrorDoc(doc, RICH_TEXT_SCHEMA);

      if (!validation.ok) {
        stats.skipped++;
        console.warn(
          `[skip] ${key}: doc convertido no valida — ${validation.errors.slice(0, 3).join(" | ")}`,
        );
        continue;
      }

      stats.converted++;

      if (dryRun) {
        if (previews.length < DRY_RUN_PREVIEW_COUNT) {
          previews.push({
            key,
            docPreview:
              JSON.stringify(doc).slice(0, 200) + (JSON.stringify(doc).length > 200 ? "…" : ""),
          });
        }
        continue;
      }

      // Update idempotente: la condición `description_doc is null` acota el
      // update al caso que estamos procesando; si otro proceso ya escribió,
      // este update afecta 0 filas y seguimos sin drama.
      const { error: updateError, count } = await admin
        .from("tickets")
        .update({ description_doc: doc as unknown as Database["public"]["Tables"]["tickets"]["Update"]["description_doc"] }, { count: "exact" })
        .eq("id", ticket.id)
        .is("description_doc", null);

      if (updateError) {
        stats.skipped++;
        console.warn(`[skip] ${key}: update falló — ${updateError.message}`);
        continue;
      }

      stats.written += count ?? 0;
    }

    console.log(
      `[batch ${Math.floor(start / BATCH_SIZE) + 1}] ` +
        `procesados=${Math.min(start + BATCH_SIZE, tickets.length)}/${tickets.length}  ` +
        `convertidos=${stats.converted}  skipped=${stats.skipped}  escritos=${stats.written}`,
    );
  }

  console.log("\n─── Resumen ─────────────────────────────");
  console.log(`Convertidos : ${stats.converted}`);
  console.log(`Skipped     : ${stats.skipped}`);
  console.log(`Escritos    : ${stats.written} ${dryRun ? "(dry-run)" : ""}`);

  if (dryRun && previews.length > 0) {
    console.log("\n─── Previews (primeros 5) ───────────────");
    for (const preview of previews) {
      console.log(`${preview.key}: ${preview.docPreview}`);
    }
  }
}

main().catch((error) => {
  console.error("\n✗ Script tiró:", error);
  process.exit(1);
});
