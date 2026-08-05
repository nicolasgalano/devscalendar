import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PendingAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-full max-w-100 flex-col justify-center gap-4 p-6">
      <div>
        <h1 className="text-title font-medium">Acceso pendiente</h1>
        <p className="mt-0.5 text-ui text-muted-foreground">
          Tu cuenta ({user.email}) todavía no tiene un rol asignado. Un administrador
          tiene que activarla para que puedas seguir.
        </p>
      </div>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline">
          Cerrar sesión
        </Button>
      </form>
    </main>
  );
}
