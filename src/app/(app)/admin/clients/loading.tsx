import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Clientes" description="Cuentas sobre las que se abren proyectos." />
      <TableSkeleton columns={3} />
    </>
  );
}
