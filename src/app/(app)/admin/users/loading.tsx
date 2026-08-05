import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Usuarios" description="Quién puede entrar y con qué rol." />
      <TableSkeleton columns={6} />
    </>
  );
}
