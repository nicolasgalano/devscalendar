import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Proyectos"
        description="Sobre estos proyectos se reservan horas de desarrollo."
      />
      <TableSkeleton columns={7} />
    </>
  );
}
