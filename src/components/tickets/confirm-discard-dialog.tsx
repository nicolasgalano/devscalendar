"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Confirm dialog al cerrar `<TicketFormDialog>` con cambios sin guardar
// (Q-6 del plan de 019). Se abre solo cuando el usuario apretó "Cancelar" y
// el editor reportó dirty; si no hay cambios, el cancel cierra directo sin
// pasar por acá.
//
// AlertDialog no está en el system de shadcn de este repo — el mismo efecto
// (dialog modal chico con foco en dos acciones) sale con el `<Dialog>` base,
// y no valió la pena sumar un componente nuevo por un solo caso.

type ConfirmDiscardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ConfirmDiscardDialog({
  open,
  onOpenChange,
  onConfirm,
}: ConfirmDiscardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Descartar cambios</DialogTitle>
          <DialogDescription>
            Vas a descartar los cambios que hiciste. ¿Seguro?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Seguir editando
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Descartar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
