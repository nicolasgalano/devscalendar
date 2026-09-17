import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Mi tiempo" description="Cargá las horas de la semana." />
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border-border rounded-md border p-2">
            <Skeleton className="mb-2 h-4 w-12" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    </>
  );
}
