import { redirect } from "next/navigation";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Acceso pendiente</h1>
      <p className="text-sm text-neutral-600">
        Tu cuenta ({user.email}) está autenticada pero todavía no tiene un rol asignado. Un
        administrador debe activarla antes de que puedas continuar.
      </p>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
