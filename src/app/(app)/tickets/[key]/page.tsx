import { notFound } from "next/navigation";

import { TicketDetail } from "@/components/tickets/ticket-detail";
import { getProjectMembers } from "@/lib/tickets/facets";
import { getTicketByKey } from "@/lib/tickets/query";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  const [ticket, profile] = await Promise.all([getTicketByKey(key), getCurrentProfile()]);
  if (!ticket) notFound();

  // El rol dentro del proyecto decide qué controles se dibujan. La verdad la
  // sigue teniendo el trigger de la base — este chequeo es UX.
  //
  // `role_in_project()` es un `security definer` que ya sabe distinguir
  // admin/PM/miembro; devuelve null cuando no aplica. La page no tira si
  // falla: en el peor caso los controles quedan deshabilitados.
  let roleInProject = null as "viewer" | "contributor" | "lead" | null;
  if (profile) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("role_in_project", {
      p_project_id: ticket.project.id,
      p_user_id: profile.id,
    });
    roleInProject = data ?? null;
  }

  const members = await getProjectMembers(ticket.project.id);

  return (
    <TicketDetail
      ticket={ticket}
      viewer={profile ? { id: profile.id, roles: profile.roles } : null}
      roleInProject={roleInProject}
      members={members}
    />
  );
}
