"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge, RecordStatus } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

type Client = { id: string; name: string };
type Pm = { id: string; full_name: string | null; email: string };
type Project = {
  id: string;
  name: string;
  priority: string;
  jira_enabled: boolean;
  slack_enabled: boolean;
  active: boolean;
  client: Client | null;
  pm: Pm | null;
};

type ProjectFormState = {
  name: string;
  clientId: string;
  pmId: string;
  priority: "normal" | "high";
  jiraEnabled: boolean;
  slackEnabled: boolean;
};

const EMPTY_FORM: ProjectFormState = {
  name: "",
  clientId: "",
  pmId: "",
  priority: "normal",
  jiraEnabled: false,
  slackEnabled: false,
};

function pmLabel(pm: Pm) {
  return pm.full_name ?? pm.email;
}

export function ProjectsTable({
  projects,
  clients,
  pms,
}: {
  projects: Project[];
  clients: Client[];
  pms: Pm[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ProjectFormState>(EMPTY_FORM);

  const [editing, setEditing] = useState<Project | null>(null);
  const [editForm, setEditForm] = useState<ProjectFormState>(EMPTY_FORM);

  const missingPrerequisite =
    pms.length === 0
      ? "Todavía no hay ningún usuario con rol PM. Creá uno en Usuarios antes de dar de alta un proyecto."
      : clients.length === 0
        ? "Todavía no hay clientes activos. Creá uno en Clientes antes de dar de alta un proyecto."
        : null;

  function openCreate() {
    setCreateForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(project: Project) {
    setEditing(project);
    setEditForm({
      name: project.name,
      clientId: project.client?.id ?? "",
      pmId: project.pm?.id ?? "",
      priority: project.priority === "high" ? "high" : "normal",
      jiraEnabled: project.jira_enabled,
      slackEnabled: project.slack_enabled,
    });
  }

  async function handleCreate() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo crear el proyecto. Probá de nuevo.");
        return;
      }
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
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
      const res = await fetch(`/api/projects/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          pmId: editForm.pmId,
          priority: editForm.priority,
          jiraEnabled: editForm.jiraEnabled,
          slackEnabled: editForm.slackEnabled,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo editar el proyecto. Probá de nuevo.");
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

  async function toggleActive(project: Project) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !project.active }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "No se pudo actualizar el proyecto. Probá de nuevo.");
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  const createValid =
    createForm.name.trim() && createForm.clientId && createForm.pmId && createForm.priority;

  const createAction = <Button onClick={openCreate}>Crear proyecto</Button>;

  return (
    <>
      <PageHeader
        title="Proyectos"
        description="Sobre estos proyectos se reservan horas de desarrollo."
        action={projects.length > 0 ? createAction : undefined}
      />

      {error && (
        <p role="alert" className="mb-3 text-ui text-destructive">
          {error}
        </p>
      )}

      {projects.length === 0 ? (
        <EmptyState
          title="Sin proyectos"
          description="Los proyectos que des de alta aparecen acá."
          action={createAction}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>PM</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead>Integraciones</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                {/* §8: los registros inactivos bajan a muted-foreground. */}
                <TableCell className={cn(!project.active && "text-muted-foreground")}>
                  {project.name}
                </TableCell>
                <TableCell>{project.client?.name ?? "—"}</TableCell>
                <TableCell>{project.pm ? pmLabel(project.pm) : "—"}</TableCell>
                <TableCell>
                  <PriorityBadge priority={project.priority} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[project.jira_enabled && "Jira", project.slack_enabled && "Slack"]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </TableCell>
                <TableCell>
                  <RecordStatus active={project.active} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(project)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(project.active && "text-destructive")}
                      onClick={() => toggleActive(project)}
                    >
                      {project.active ? "Desactivar" : "Activar"}
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
            <DialogTitle>Nuevo proyecto</DialogTitle>
            {missingPrerequisite && (
              <DialogDescription>{missingPrerequisite}</DialogDescription>
            )}
          </DialogHeader>
          {!missingPrerequisite && (
            <ProjectForm
              form={createForm}
              onChange={setCreateForm}
              clients={clients}
              pms={pms}
            />
          )}
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={!!missingPrerequisite || !createValid || submitting}
            >
              Crear proyecto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar proyecto</DialogTitle>
          </DialogHeader>
          <ProjectForm
            form={editForm}
            onChange={setEditForm}
            clients={clients}
            pms={pms}
            lockClient
          />
          <DialogFooter>
            <Button
              onClick={handleEdit}
              disabled={!editForm.name.trim() || !editForm.pmId || submitting}
            >
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectForm({
  form,
  onChange,
  clients,
  pms,
  lockClient = false,
}: {
  form: ProjectFormState;
  onChange: (form: ProjectFormState) => void;
  clients: Client[];
  pms: Pm[];
  lockClient?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-name">Nombre</Label>
        <Input
          id="project-name"
          value={form.name}
          placeholder="Rediseño del checkout"
          onChange={(e) => onChange({ ...form, name: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Cliente</Label>
        <Select
          value={form.clientId}
          onValueChange={(value) => onChange({ ...form, clientId: value as string })}
          disabled={lockClient}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Elegí un cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>PM responsable</Label>
        <Select
          value={form.pmId}
          onValueChange={(value) => onChange({ ...form, pmId: value as string })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Elegí un PM" />
          </SelectTrigger>
          <SelectContent>
            {pms.map((pm) => (
              <SelectItem key={pm.id} value={pm.id}>
                {pmLabel(pm)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Prioridad</Label>
        <Select
          value={form.priority}
          onValueChange={(value) => onChange({ ...form, priority: value as "normal" | "high" })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* §11: el vocabulario es el del PM, no el de la base de datos. */}
            <SelectItem value="normal">Común</SelectItem>
            <SelectItem value="high">Prioritario</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={form.jiraEnabled}
            onCheckedChange={(checked) => onChange({ ...form, jiraEnabled: checked === true })}
          />
          Jira habilitado
        </Label>
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={form.slackEnabled}
            onCheckedChange={(checked) => onChange({ ...form, slackEnabled: checked === true })}
          />
          Slack habilitado
        </Label>
      </div>
    </div>
  );
}
