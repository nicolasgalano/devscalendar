import { redirect } from "next/navigation";

/**
 * Raíz del segmento del proyecto (feature 017 T2.8). Siempre redirige al tab
 * "Tablero" para que la URL canónica incluya la vista activa — así el active
 * de la tab se determina por segmento del path, sin query params.
 */
export default async function ProjectWorkspaceRoot({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  // 018: el default del workspace pasa de "Tablero" a "Sprint" — la vista del
  // sprint activo es la que el equipo mira el 95% del tiempo.
  redirect(`/projects/${projectKey}/sprint`);
}
