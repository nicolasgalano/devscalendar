/**
 * DESIGN.md §9: título que nombra el espacio, una línea de explicación y un
 * botón con verbo. Sin ilustración.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border px-4 py-8">
      <div>
        <p className="text-emphasis font-medium">{title}</p>
        <p className="mt-0.5 text-ui text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * §9: "sin resultados de filtro" es un estado distinto del vacío — nombra el
 * filtro aplicado y ofrece limpiarlo.
 */
export function NoResultsState({
  description,
  onClear,
}: {
  description: string;
  onClear?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border px-4 py-8">
      <p className="text-ui text-muted-foreground">{description}</p>
      {onClear}
    </div>
  );
}
