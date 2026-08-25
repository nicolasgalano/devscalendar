/**
 * Credenciales del Supabase contra el que corren los tests automáticos.
 *
 * **Solo acepta un stack local/efímero.** Los tests de integración, la suite
 * smoke y los E2E usan la `service_role` key y crean y borran usuarios,
 * clientes, proyectos y reservas. Apuntados a un proyecto alojado —el de
 * desarrollo o, el día de mañana, el de producción— le destruirían datos a algo
 * que le importa a alguien.
 *
 * Por eso acá **no se lee `.env.local`**. Las variables llegan del entorno del
 * job, que en CI las exporta desde el stack que levanta `supabase start`. Si la
 * URL no es local, esto tira y la corrida se corta antes de escribir nada.
 *
 * El único uso legítimo del proyecto remoto es la prueba manual, y ese camino
 * pasa por `scripts/cleanup-test-data.ts`, nunca por acá. Ver `docs/testing.md`.
 */

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type TestSupabaseEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

/** Hosts que aceptamos como stack efímero. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

export function isLocalSupabaseUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function loadTestEnv(): TestSupabaseEnv {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno para los tests: ${missing.join(", ")}.\n\n` +
        "Los tests de integración, smoke y E2E corren contra el stack efímero de " +
        "Supabase que se levanta en CI (`supabase start`), no contra un proyecto " +
        "alojado. En tu máquina no se pueden correr: usá `pnpm test:unit`, que no " +
        "necesita ninguna base. Ver docs/testing.md.",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      `Los tests automáticos apuntan a ${url}, que no es un stack local.\n\n` +
        "Está bloqueado a propósito: esta suite crea y borra usuarios y filas con " +
        "la service_role key, así que contra un proyecto alojado destruye datos " +
        "reales. Si querés probar algo contra el proyecto remoto, hacelo a mano y " +
        "seguí el procedimiento de docs/testing.md.",
    );
  }

  return {
    url,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}
