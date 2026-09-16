"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useSyncIndicator } from "@/components/sync-indicator";
import { RecordStatus } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectMemberRow } from "@/lib/projects/workspace";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type ProjectRole = Database["public"]["Enums"]["project_member_role"];

const ROLE_LABEL: Record<ProjectRole, string> = {
  viewer: "Viewer",
  contributor: "Contributor",
  lead: "Lead",
};

const ROLE_ORDER: ProjectRole[] = ["viewer", "contributor", "lead"];

type Addable = { id: string; name: string };

/**
 * Panel de miembros del proyecto (feature 015 P8, T8.2). Vive dentro del
 * workspace del proyecto — `/projects/[key]/members`. El guard admin/PM ya lo
 * hizo el layout, así que este componente asume que puede mutar.
 *
 * **Comportamiento del PM primario:**
 * El trigger `autoadd_pm_as_lead` mantiene al PM del proyecto como `lead` en
 * `project_members` automáticamente. Acá se muestra con badge `(PM)` y su
 * toggle "Activo" queda deshabilitado — es una protección de UI para no
 * hostigar al PM con confirmaciones dobles al desactivarse a sí mismo del
 * proyecto que gestiona; el service_role sí puede hacerlo. El cambio de rol
 * también se deshabilita porque el trigger lo va a re-asignar a `lead` en el
 * próximo update de `projects.pm_id` de todos modos.
 *
 * **Add flow:**
 * Dialog con Select de usuarios candidatos (activos y no-ya-miembros) + Select
 * de rol. `POST /api/project-members` — el 409 lo devuelve el handler cuando
 * la unique `(project_id, user_id)` choca, y ahí ofrecemos reactivar en vez
 * de re-crear (evita bajar un `lead` desactivado a `contributor` sin querer).
 */
export function ProjectMembersPanel({
  members,
  addable,
  projectId,
}: {
  members: ProjectMemberRow[];
  addable: Addable[];
  projectId: string;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<ProjectMemberRow | null>(null);

  // Add form state
  const [addUserId, setAddUserId] = useState<string>("");
  const [addRole, setAddRole] = useState<ProjectRole>("contributor");

  async function callApi(
    url: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    label: string,
  ): Promise<{ ok: boolean; error?: string }> {
    setError(null);
    const stop = startSync(label);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        const msg = payload.reason ?? payload.error ?? "No se pudo completar la acción.";
        setError(msg);
        return { ok: false, error: msg };
      }
      router.refresh();
      return { ok: true };
    } catch {
      const msg = "No se pudo conectar con el servidor.";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      stop();
    }
  }

  async function handleAdd() {
    if (!addUserId) return;
    const result = await callApi(
      "/api/project-members",
      "POST",
      {
        project_id: projectId,
        user_id: addUserId,
        role_in_project: addRole,
      },
      "Agregando miembro",
    );
    if (result.ok) {
      setAddOpen(false);
      setAddUserId("");
      setAddRole("contributor");
    }
  }

  async function handleRoleChange(member: ProjectMemberRow, nextRole: ProjectRole) {
    if (nextRole === member.roleInProject) return;
    await callApi(
      `/api/project-members/${member.id}`,
      "PATCH",
      { role_in_project: nextRole },
      "Cambiando rol",
    );
  }

  async function handleToggleActive(member: ProjectMemberRow) {
    // Reactivar es directo; desactivar pasa por confirmación (§7 de DESIGN.md).
    if (!member.active) {
      await callApi(
        `/api/project-members/${member.id}`,
        "PATCH",
        { active: true },
        "Reactivando miembro",
      );
      return;
    }
    setConfirmDeactivate(member);
  }

  async function confirmDeactivateNow() {
    if (!confirmDeactivate) return;
    const result = await callApi(
      `/api/project-members/${confirmDeactivate.id}`,
      "PATCH",
      { active: false },
      "Desactivando miembro",
    );
    if (result.ok) setConfirmDeactivate(null);
  }

  const addAction = (
    <Button size="sm" onClick={() => setAddOpen(true)} disabled={addable.length === 0}>
      Agregar miembro
    </Button>
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-ui text-muted-foreground">
          {members.length} {members.length === 1 ? "miembro" : "miembros"} en el proyecto.
        </p>
        {addAction}
      </div>

      {error && (
        <p role="alert" className="text-ui text-destructive mb-3">
          {error}
        </p>
      )}

      {members.length === 0 ? (
        <p className="text-ui text-muted-foreground italic">Sin miembros todavía.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-44">Rol</TableHead>
              <TableHead className="w-28">Estado</TableHead>
              <TableHead className="w-32 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow
                key={member.id}
                className={cn(!member.active && "text-muted-foreground")}
              >
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span className={cn(member.active && "text-foreground")}>{member.name}</span>
                    {member.isProjectPm && (
                      <Badge variant="secondary" className="font-caption">
                        PM
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>
                  <Select
                    value={member.roleInProject}
                    onValueChange={(next) => handleRoleChange(member, next as ProjectRole)}
                    disabled={member.isProjectPm}
                  >
                    <SelectTrigger size="sm" className="w-fit">
                      <SelectValue>{ROLE_LABEL[member.roleInProject]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false}>
                      {ROLE_ORDER.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <RecordStatus active={member.active} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleActive(member)}
                    disabled={member.isProjectPm}
                    className={cn(member.active && !member.isProjectPm && "text-destructive")}
                  >
                    {member.active ? "Desactivar" : "Reactivar"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        addable={addable}
        userId={addUserId}
        onUserIdChange={setAddUserId}
        role={addRole}
        onRoleChange={setAddRole}
        onSubmit={handleAdd}
      />

      <Dialog
        open={confirmDeactivate !== null}
        onOpenChange={(open) => !open && setConfirmDeactivate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desactivar a {confirmDeactivate?.name}</DialogTitle>
            <DialogDescription>
              El miembro deja de aparecer en el selector de asignados de tickets y en el resto de
              las vistas del proyecto. Los tickets que le hayan sido asignados no se desasignan
              automáticamente. Podés reactivarlo desde este mismo panel.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeactivate(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDeactivateNow}>
              Desactivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  addable,
  userId,
  onUserIdChange,
  role,
  onRoleChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addable: Addable[];
  userId: string;
  onUserIdChange: (value: string) => void;
  role: ProjectRole;
  onRoleChange: (value: ProjectRole) => void;
  onSubmit: () => void;
}) {
  const selected = useMemo(
    () => addable.find((person) => person.id === userId),
    [addable, userId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar miembro</DialogTitle>
          {addable.length === 0 && (
            <DialogDescription>
              Todos los usuarios activos ya son miembros del proyecto.
            </DialogDescription>
          )}
        </DialogHeader>

        {addable.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Usuario</Label>
              <Select value={userId} onValueChange={(next) => onUserIdChange(next ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elegí un usuario">{selected?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {addable.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Rol en el proyecto</Label>
              <Select value={role} onValueChange={(value) => onRoleChange(value as ProjectRole)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{ROLE_LABEL[role]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLE_ORDER.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ROLE_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={!userId || addable.length === 0}>
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
