import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Cargando…" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-full max-w-md" />
        <Skeleton className="h-6 w-full max-w-xs" />
        <Skeleton className="h-32 w-full" />
      </div>
    </>
  );
}
