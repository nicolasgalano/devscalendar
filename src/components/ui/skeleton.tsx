import { cn } from "@/lib/utils";

/**
 * DESIGN.md §9: los skeletons replican la forma exacta del contenido final.
 * El pulso se desactiva vía la regla global de `prefers-reduced-motion`.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
