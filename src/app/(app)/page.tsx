import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  pm: "PM",
  developer: "Developer",
};

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.active || !profile.role) {
    redirect("/pending-access");
  }

  return (
    <>
      <PageHeader
        title="Inicio"
        description="El calendario de reservas llega con la próxima entrega."
      />

      {/* §6: el ancho máximo solo se aplica a texto de lectura y formularios. */}
      <dl className="max-w-160 divide-y divide-border border-y border-border">
        <div className="flex h-9 items-center justify-between gap-4 px-2">
          <dt className="text-caption text-muted-foreground">Nombre</dt>
          <dd>{profile.full_name ?? "—"}</dd>
        </div>
        <div className="flex h-9 items-center justify-between gap-4 px-2">
          <dt className="text-caption text-muted-foreground">Email</dt>
          <dd>{profile.email}</dd>
        </div>
        <div className="flex h-9 items-center justify-between gap-4 px-2">
          <dt className="text-caption text-muted-foreground">Rol</dt>
          <dd>{ROLE_LABEL[profile.role] ?? profile.role}</dd>
        </div>
      </dl>
    </>
  );
}
