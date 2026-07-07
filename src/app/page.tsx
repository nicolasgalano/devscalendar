import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-3xl font-semibold">DevsCalendar</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Bienvenido/a, {profile.full_name ?? profile.email}.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Email</dt>
            <dd className="font-medium">{profile.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Rol</dt>
            <dd className="font-medium capitalize">{profile.role}</dd>
          </div>
        </dl>
      </div>

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
