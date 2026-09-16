import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-3">
      <div className="border-border flex flex-col gap-2 rounded-md border p-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-3 w-48" />
        <Skeleton className="mt-2 h-1 w-full" />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex w-60 shrink-0 flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <div className="bg-surface min-h-96 rounded-md p-1.5">
              <Skeleton className="mb-1.5 h-16 w-full" />
              <Skeleton className="mb-1.5 h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
