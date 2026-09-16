"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { SprintFormDialog } from "./sprint-form-dialog";

/**
 * Wrapper CTA del alta de sprint (018 T4.5). Se usa en el empty state del tab
 * y en el header de "Próximos sprints" cuando el PM quiere planear otro.
 * Mismo patrón que `<CreateTicketButton>` de 015.
 */
export function CreateSprintButton({
  projectId,
  label = "Crear sprint",
  size = "sm",
}: {
  projectId: string;
  label?: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <SprintFormDialog
        mode="create"
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
      />
    </>
  );
}
