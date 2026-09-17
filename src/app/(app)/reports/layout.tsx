import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { ReportsTabs } from "@/components/reports/reports-tabs";
import { hasPmScope } from "@/lib/auth/roles";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Layout de Reportes (016 Phase 6). Guard: admin o PM. Cualquier otro rol
 * intentando entrar por URL directa cae a `/`. El link del sidebar solo
 * aparece para quienes pasan el guard.
 */
export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !hasPmScope(profile.roles)) {
    redirect("/");
  }

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Consumo por proyecto y comparación con lo planificado."
      />
      <ReportsTabs />
      {children}
    </>
  );
}
