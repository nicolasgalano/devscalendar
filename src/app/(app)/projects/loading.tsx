import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Proyectos"
        description="Elegí un proyecto para ver su tablero o su backlog."
      />
      <TableSkeleton columns={6} />
    </>
  );
}
