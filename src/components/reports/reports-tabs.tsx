"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function ReportsTabs() {
  const pathname = usePathname();
  const isConsumo = pathname.endsWith("/consumo");
  const isPlanVsReal = pathname.endsWith("/plan-vs-real");

  return (
    <nav aria-label="Reportes" className="border-border mb-4 flex gap-4 border-b">
      <TabLink href="/reports/consumo" active={isConsumo} label="Consumo" />
      <TabLink
        href="/reports/plan-vs-real"
        active={isPlanVsReal}
        label="Plan vs real"
      />
    </nav>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-ui focus-visible:outline-ring -mb-px border-b-2 px-1 py-2 outline-none",
        "focus-visible:outline-2 focus-visible:-outline-offset-2",
        active
          ? "border-primary text-primary font-medium"
          : "text-secondary-foreground hover:text-foreground border-transparent",
      )}
    >
      {label}
    </Link>
  );
}
