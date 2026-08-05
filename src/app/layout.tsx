import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

import "./globals.css";

// DESIGN.md §4: Archivo para toda la interfaz, JetBrains Mono para datos
// (ids, timestamps, duraciones).
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "DevsCalendar",
  description: "Planificación de recursos para equipos de desarrollo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={cn(archivo.variable, jetbrainsMono.variable)}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
