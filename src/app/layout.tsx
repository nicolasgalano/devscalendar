import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "DevsCalendar",
  description: "Planificación de recursos para equipos de desarrollo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-full bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
