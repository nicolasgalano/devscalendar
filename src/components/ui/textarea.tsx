import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Mismos estilos que `Input`, ajustados a la escala de densidad al instalarlo
 * (ADR 0006): el default de shadcn trae `min-h-16` con `py-2`, que en una
 * pantalla de trabajo ocupa el lugar de dos controles. Acá son tres líneas de
 * 13px y el alto lo maneja el usuario.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-14 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-ui transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
