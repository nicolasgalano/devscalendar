"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * DESIGN.md §9: qué pasó y qué hacer, en una línea, con botón de reintentar.
 * Sin prefijo "Error:", sin primera persona, sin exponer el mensaje crudo.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // El detalle crudo va al log, no a la pantalla.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-border px-4 py-8"
    >
      <div>
        <p className="text-emphasis font-medium">No se pudieron cargar los datos</p>
        <p className="mt-0.5 text-ui text-muted-foreground">
          La conexión con el servidor falló. Probá de nuevo en unos segundos.
        </p>
      </div>
      <Button variant="outline" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
