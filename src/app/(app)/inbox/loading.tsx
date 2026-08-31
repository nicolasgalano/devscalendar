import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Reservas pendientes"
        description="Lo que te reservaron y todavía no respondiste."
      />
      <TableSkeleton columns={4} />
    </>
  );
}
