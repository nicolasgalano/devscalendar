import { loadTestEnv } from "../env";

/**
 * Integración y smoke corren contra el stack efímero de Supabase de CI. El
 * guard vive en `tests/env.ts` y rechaza cualquier URL que no sea local, que es
 * lo que impide que la suite le escriba a un proyecto alojado.
 */
loadTestEnv();
