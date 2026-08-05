"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * DESIGN.md §3: tema claro / oscuro / sistema, por defecto sistema.
 * `next-themes` inyecta el script que aplica la clase antes del primer paint,
 * así no hay flash de tema incorrecto.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
