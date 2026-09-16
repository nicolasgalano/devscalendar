import { redirect } from "next/navigation";

/**
 * 2026-09-16: la tab "Tablero completo" (originalmente `/board` de 017) se
 * removió del workspace cuando 018 introdujo la tab "Sprint" que también es
 * un kanban — dos kanban en el mismo workspace se pisaban conceptualmente.
 *
 * La ruta se conserva como redirect a `/sprint` para no romper bookmarks
 * viejos ni links en emails. Cuando cambien todos, se puede eliminar entera.
 */
export default async function BoardRedirect({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  redirect(`/projects/${projectKey}/sprint`);
}
