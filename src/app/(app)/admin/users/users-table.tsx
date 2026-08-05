"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RecordStatus } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

type UserRole = "admin" | "pm" | "developer";

type Pm = { id: string; full_name: string | null; email: string };
type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole | null;
  active: boolean;
  primary_pm_id: string | null;
};
type Invite = { email: string; role: UserRole; created_at: string };

const NO_PRIMARY_PM = "__none__";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  pm: "PM",
  developer: "Developer",
};

function pmLabel(pm: Pm) {
  return pm.full_name ?? pm.email;
}

export function UsersTable({
  profiles,
  invites,
  pms,
}: {
  profiles: Profile[];
  invites: Invite[];
  pms: Pm[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("developer");

  const [editing, setEditing] = useState<Profile | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("developer");
  const [editActive, setEditActive] = useState(true);
  const [editPrimaryPmId, setEditPrimaryPmId] = useState<string>(NO_PRIMARY_PM);

  function openInvite() {
    setInviteEmail("");
    setInviteRole("developer");
    setInviteOpen(true);
  }

  function openEdit(profile: Profile) {
    setEditing(profile);
    setEditRole(profile.role ?? "developer");
    setEditActive(profile.active);
    setEditPrimaryPmId(profile.primary_pm_id ?? NO_PRIMARY_PM);
  }

  async function handleInvite() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo invitar al usuario. Probá de nuevo.");
        return;
      }
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("developer");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit() {
    if (!editing) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/users/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editRole,
          active: editActive,
          primaryPmId: editPrimaryPmId === NO_PRIMARY_PM ? null : editPrimaryPmId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo editar el usuario. Probá de nuevo.");
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

  const inviteAction = <Button onClick={openInvite}>Invitar usuario</Button>;

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Quién puede entrar y con qué rol."
        action={profiles.length > 0 ? inviteAction : undefined}
      />

      {error && (
        <p role="alert" className="mb-3 text-ui text-destructive">
          {error}
        </p>
      )}

      {profiles.length === 0 ? (
        <EmptyState
          title="Sin usuarios"
          description="Los usuarios aparecen acá después de su primer ingreso con Google."
          action={inviteAction}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>PM primario</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((profile) => {
              const primaryPm = pms.find((pm) => pm.id === profile.primary_pm_id);
              return (
                <TableRow key={profile.id}>
                  <TableCell className={cn(!profile.active && "text-muted-foreground")}>
                    {profile.email}
                  </TableCell>
                  <TableCell>{profile.full_name ?? "—"}</TableCell>
                  {/* §3.2: el rol no es urgencia — se comunica con texto, no con color. */}
                  <TableCell
                    className={cn(!profile.role && "text-muted-foreground italic")}
                  >
                    {profile.role ? ROLE_LABEL[profile.role] : "Sin rol"}
                  </TableCell>
                  <TableCell>{primaryPm ? pmLabel(primaryPm) : "—"}</TableCell>
                  <TableCell>
                    <RecordStatus active={profile.active} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(profile)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {invites.length > 0 && (
        <section className="mt-8">
          <h2 className="pb-2 text-section font-medium">Invitaciones pendientes</h2>
          <p className="pb-2 text-ui text-muted-foreground">
            Reciben el rol asignado en su primer ingreso con Google.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.email}>
                  <TableCell>{invite.email}</TableCell>
                  <TableCell>{ROLE_LABEL[invite.role]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitar usuario</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                placeholder="nombre@empresa.com"
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Rol</Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as UserRole)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="pm">PM</SelectItem>
                  <SelectItem value="developer">Developer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || submitting}>
              Invitar usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Rol</Label>
              <Select value={editRole} onValueChange={(value) => setEditRole(value as UserRole)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="pm">PM</SelectItem>
                  <SelectItem value="developer">Developer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>PM primario</Label>
              <Select
                value={editPrimaryPmId}
                onValueChange={(value) => setEditPrimaryPmId(value as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PRIMARY_PM}>Ninguno</SelectItem>
                  {pms.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>
                      {pmLabel(pm)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Label className="flex items-center gap-2">
              <Checkbox
                checked={editActive}
                onCheckedChange={(checked) => setEditActive(checked === true)}
              />
              Activo
            </Label>
          </div>
          <DialogFooter>
            <Button onClick={handleEdit} disabled={submitting}>
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
