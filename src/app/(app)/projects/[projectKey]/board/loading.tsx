import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex w-60 shrink-0 flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <div className="bg-surface min-h-96 rounded-md p-1.5">
            <Skeleton className="mb-1.5 h-16 w-full" />
            <Skeleton className="mb-1.5 h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
