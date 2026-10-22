import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Planificación"
        description="Elegí un proyecto para ver y cargar su capacidad estimada por día."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-96 w-full" />
    </>
  );
}
