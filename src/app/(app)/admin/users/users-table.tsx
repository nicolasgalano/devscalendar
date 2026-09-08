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
import { ROLE_LABEL, ROLE_ORDER, formatRoles, sortRoles, type UserRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type Pm = { id: string; full_name: string | null; email: string };
type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  roles: UserRole[];
  active: boolean;
  primary_pm_id: string | null;
};
type Invite = { email: string; roles: UserRole[]; created_at: string };

const NO_PRIMARY_PM = "__none__";

function pmLabel(pm: Pm) {
  return pm.full_name ?? pm.email;
}

/**
 * `012` / D-09: los roles son un conjunto, así que el control es una casilla por
 * rol y no un desplegable.
 *
 * De paso se llevó puestos **dos de los seis casos de D-04**: el `<SelectValue>`
 * sin hijos que imprimía `developer` en vez de `Developer` desapareció con el
 * `Select`. Los otros cuatro se arreglaron en `013`.
 *
 * El mensaje de "al menos uno" se muestra en lugar de deshabilitar en silencio:
 * un botón gris sin explicación es la forma más rápida de que alguien crea que
 * la pantalla está rota. La regla la impone igual el schema con un 400 (AC-1.4).
 */
function RolesField({
  value,
  onChange,
}: {
  value: UserRole[];
  onChange: (roles: UserRole[]) => void;
}) {
  function toggle(role: UserRole, checked: boolean) {
    onChange(sortRoles(checked ? [...value, role] : value.filter((r) => r !== role)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Roles</Label>
      <div className="flex flex-col gap-2">
        {ROLE_ORDER.map((role) => (
          <Label key={role} className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={value.includes(role)}
              onCheckedChange={(checked) => toggle(role, checked === true)}
            />
            {ROLE_LABEL[role]}
          </Label>
        ))}
      </div>
      {value.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Elegí al menos un rol. Para dar de baja a alguien, desmarcá «Activo».
        </p>
      )}
    </div>
  );
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
  const [inviteRoles, setInviteRoles] = useState<UserRole[]>(["developer"]);

  const [editing, setEditing] = useState<Profile | null>(null);
  const [editRoles, setEditRoles] = useState<UserRole[]>(["developer"]);
  const [editActive, setEditActive] = useState(true);
  const [editPrimaryPmId, setEditPrimaryPmId] = useState<string>(NO_PRIMARY_PM);

  function openInvite() {
    setInviteEmail("");
    setInviteRoles(["developer"]);
    setInviteOpen(true);
  }

  function openEdit(profile: Profile) {
    setEditing(profile);
    setEditRoles(profile.roles);
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
        body: JSON.stringify({ email: inviteEmail, roles: inviteRoles }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo invitar al usuario. Probá de nuevo.");
        return;
      }
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRoles(["developer"]);
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
          roles: editRoles,
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
        <p role="alert" className="text-ui text-destructive mb-3">
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
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell className={cn(!profile.active && "text-muted-foreground")}>
                    {profile.email}
                  </TableCell>
                  <TableCell>{profile.full_name ?? "—"}</TableCell>
                  {/* §3.2: el rol no es urgencia — se comunica con texto, no con color.
                      Desde `012` son varios, y van separados por `·` en vez de en
                      badges: tres badges por fila compiten con el estado, que sí
                      es la señal que se busca al escanear la tabla. */}
                  <TableCell
                    className={cn(profile.roles.length === 0 && "text-muted-foreground italic")}
                  >
                    {formatRoles(profile.roles) ?? "Sin rol"}
                  </TableCell>
                  <TableCell>
                    <RecordStatus active={profile.active} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(profile)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {invites.length > 0 && (
        <section className="mt-8">
          <h2 className="text-section pb-2 font-medium">Invitaciones pendientes</h2>
          <p className="text-ui text-muted-foreground pb-2">
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
                  <TableCell>{formatRoles(invite.roles)}</TableCell>
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
            <RolesField value={inviteRoles} onChange={setInviteRoles} />
          </div>
          <DialogFooter>
            <Button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviteRoles.length === 0 || submitting}
            >
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
            <RolesField value={editRoles} onChange={setEditRoles} />

            <div className="flex flex-col gap-1.5">
              <Label>PM primario</Label>
              <Select
                value={editPrimaryPmId}
                onValueChange={(value) => setEditPrimaryPmId(value as string)}
              >
                <SelectTrigger className="w-full">
                  {/* D-04: `SelectValue` sin hijos imprime el **valor** —acá un
                      uuid, o el literal `__none__`—, no el texto del item. */}
                  <SelectValue>
                    {editPrimaryPmId === NO_PRIMARY_PM
                      ? "Ninguno"
                      : (pms.find((pm) => pm.id === editPrimaryPmId)?.full_name ??
                        pms.find((pm) => pm.id === editPrimaryPmId)?.email ??
                        "Ninguno")}
                  </SelectValue>
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
            <Button onClick={handleEdit} disabled={editRoles.length === 0 || submitting}>
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
