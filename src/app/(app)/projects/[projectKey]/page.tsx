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
  redirect(`/projects/${projectKey}/board`);
}
