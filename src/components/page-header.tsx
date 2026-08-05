/**
 * DESIGN.md §4: el título de página es la misma familia a 20px con tracking
 * ajustado, peso 500. No hay tipografía display separada.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        <h1 className="text-title font-medium">{title}</h1>
        {description && (
          <p className="mt-0.5 text-ui text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
