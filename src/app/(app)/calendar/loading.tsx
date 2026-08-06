import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * DESIGN.md §9: a skeleton with the shape of the final content, never a
 * centred spinner. This one mirrors the month grid, which is the default view.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Calendario"
        description="Reservas de tiempo de los desarrolladores sobre cada proyecto."
      />

      <div className="flex items-center gap-2 pb-4">
        <Skeleton className="h-7 w-7" />
        <Skeleton className="h-7 w-7" />
        <Skeleton className="h-7 w-14" />
        <Skeleton className="h-4 w-40" />
      </div>

      <div
        aria-busy="true"
        aria-live="polite"
        className="grid grid-cols-7 overflow-hidden rounded-lg border-t border-r border-border"
      >
        <span className="sr-only">Cargando el calendario…</span>
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={`head-${index}`} className="border-b border-l border-border px-2 py-1.5">
            <Skeleton className="h-2.5 w-3" />
          </div>
        ))}
        {Array.from({ length: 35 }).map((_, index) => (
          <div
            key={index}
            className="min-h-24 border-b border-l border-border p-2"
          >
            <Skeleton className="h-2.5 w-4" />
          </div>
        ))}
      </div>
    </>
  );
}
