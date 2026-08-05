"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RecordStatus } from "@/components/status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Client = {
  id: string;
  name: string;
  active: boolean;
};

export function ClientsTable({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const [editing, setEditing] = useState<Client | null>(null);
  const [editName, setEditName] = useState("");

  const [confirming, setConfirming] = useState<{
    client: Client;
    activeProjectsCount: number;
  } | null>(null);

  async function handleCreate() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo crear el cliente. Probá de nuevo.");
        return;
      }
      setCreateOpen(false);
      setCreateName("");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRename() {
    if (!editing) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo editar el cliente. Probá de nuevo.");
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(client: Client, confirmDeactivate = false) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active: !client.active,
          ...(confirmDeactivate && { confirmDeactivateWithActiveProjects: true }),
        }),
      });
      const body = await res.json();
      if (res.status === 409 && body.requiresConfirmation) {
        setConfirming({ client, activeProjectsCount: body.activeProjectsCount });
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "No se pudo actualizar el cliente. Probá de nuevo.");
        return;
      }
      setConfirming(null);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  function openCreate() {
    setCreateName("");
    setCreateOpen(true);
  }

  const createAction = <Button onClick={openCreate}>Crear cliente</Button>;

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cuentas sobre las que se abren proyectos."
        // §9: con la lista vacía la acción primaria vive en el empty state,
        // para no duplicar la única acción primaria de la vista.
        action={clients.length > 0 ? createAction : undefined}
      />

      {error && (
        <p role="alert" className="mb-3 text-ui text-destructive">
          {error}
        </p>
      )}

      {clients.length === 0 ? (
        <EmptyState
          title="Sin clientes"
          description="Los clientes que des de alta aparecen acá."
          action={createAction}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id}>
                {/* §8: los registros inactivos bajan a muted-foreground. */}
                <TableCell className={cn(!client.active && "text-muted-foreground")}>
                  {client.name}
                </TableCell>
                <TableCell>
                  <RecordStatus active={client.active} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(client);
                        setEditName(client.name);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(client.active && "text-destructive")}
                      onClick={() => toggleActive(client)}
                    >
                      {client.active ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>El nombre tiene que ser único.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-name">Nombre</Label>
            <Input
              id="client-name"
              value={createName}
              placeholder="Acme S.A."
              onChange={(e) => setCreateName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={!createName.trim() || submitting}>
              Crear cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-client-name">Nombre</Label>
            <Input
              id="edit-client-name"
              value={editName}
              placeholder="Acme S.A."
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleRename} disabled={!editName.trim() || submitting}>
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desactivar cliente</DialogTitle>
            <DialogDescription>
              {confirming?.client.name} tiene {confirming?.activeProjectsCount}{" "}
              {confirming?.activeProjectsCount === 1
                ? "proyecto activo"
                : "proyectos activos"}
              . Los proyectos no se desactivan automáticamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => confirming && toggleActive(confirming.client, true)}
              disabled={submitting}
            >
              Desactivar cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
