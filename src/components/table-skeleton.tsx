import { Skeleton } from "@/components/ui/skeleton";

/**
 * DESIGN.md §9: skeletons con la forma exacta del contenido final, respetando
 * el alto de fila de 36px. Nunca un spinner centrado en la página.
 */
export function TableSkeleton({
  columns,
  rows = 6,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <div className="w-full" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="flex h-9 items-center gap-4 border-b border-border px-2">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex h-9 items-center gap-4 border-b border-border px-2"
        >
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton key={columnIndex} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
