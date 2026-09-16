"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { TicketFormDialog, type TicketFormInitial } from "./ticket-form-dialog";

/**
 * CTA "Crear ticket" del listado global. Vive como client component porque el
 * dialog es cliente puro. Abre automáticamente si el URL trae `?new=1` — así
 * el link del empty state y el botón del header comparten camino, y el atrás
 * del navegador cierra el dialog en vez de dejarlo colgado en el historial.
 *
 * `?projectId=` se respeta como preselección: linkear a
 * `?new=1&projectId=<id>` desde cualquier ruta que tenga este botón abre el
 * form con ese proyecto elegido (por ejemplo desde el header del workspace
 * de proyecto en `017`).
 */
export function CreateTicketButton({
  projects,
  membersByProject,
  defaultProjectId = null,
}: {
  projects: { id: string; key: string; name: string }[];
  membersByProject: Record<string, { id: string; name: string }[]>;
  defaultProjectId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Abrir cuando el URL trae `?new=1`. Se cierra reescribiendo la URL sin ese
  // param, así el botón "atrás" también cierra.
  useEffect(() => {
    setOpen(searchParams.get("new") === "1");
  }, [searchParams]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && searchParams.get("new") === "1") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }
  }

  const projectFromUrl = searchParams.get("projectId");
  const preselectedProject =
    projectFromUrl && projects.some((project) => project.id === projectFromUrl)
      ? projectFromUrl
      : defaultProjectId;

  const initial: TicketFormInitial = {
    projectId: preselectedProject,
    title: "",
    description: "",
    priority: "medium",
    assigneeId: null,
  };

  return (
    <>
      <Button size="sm" onClick={() => handleOpenChange(true)}>
        Crear ticket
      </Button>
      <TicketFormDialog
        mode="create"
        open={open}
        onOpenChange={handleOpenChange}
        initial={initial}
        projects={projects}
        membersByProject={membersByProject}
      />
    </>
  );
}
