import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Mi trabajo" description="Todos tus tickets abiertos, cross-project." />
      <TableSkeleton columns={6} />
    </>
  );
}
