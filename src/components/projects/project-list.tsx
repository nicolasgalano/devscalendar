import Link from "next/link";

import { RecordStatus } from "@/components/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectListRow } from "@/lib/projects/workspace";
import { cn } from "@/lib/utils";

/**
 * Listado de proyectos visibles (feature 017 T2.3). Tabla siguiendo la misma
 * densidad que `/admin/projects`: filas de 36px, hairlines, sin cards.
 *
 * La fila entera es un link al workspace del proyecto (`/projects/[key]/board`).
 * Proyectos inactivos bajan a `text-muted-foreground` — el criterio de §8 para
 * registros terminales o suspendidos.
 */
export function ProjectList({ projects }: { projects: ProjectListRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Clave</TableHead>
          <TableHead>Proyecto</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>PM</TableHead>
          <TableHead className="w-28">Estado</TableHead>
          <TableHead className="w-40 text-right">Tickets abiertos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </TableBody>
    </Table>
  );
}

function ProjectRow({ project }: { project: ProjectListRow }) {
  const href = `/projects/${project.key}/board`;
  return (
    <TableRow
      className={cn(
        "hover:bg-surface-hover cursor-pointer",
        !project.active && "text-muted-foreground",
      )}
    >
      <TableCell className="font-data text-primary">
        <Link href={href} className="focus-visible:outline-ring rounded-sm outline-none focus-visible:outline-2">
          {project.key}
        </Link>
      </TableCell>
      <TableCell className={cn(project.active ? "text-foreground" : undefined)}>
        <Link href={href} className="hover:underline">
          {project.name}
        </Link>
      </TableCell>
      <TableCell>{project.client?.name ?? "—"}</TableCell>
      <TableCell>{project.pm?.name ?? "—"}</TableCell>
      <TableCell>
        <RecordStatus active={project.active} />
      </TableCell>
      <TableCell className="font-data text-right">{project.openTicketCount}</TableCell>
    </TableRow>
  );
}
