import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { LoginButton } from "./login-button";

export const dynamic = "force-dynamic";

type SearchParams = { next?: string; error?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  const { next, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-3xl font-semibold">DevsCalendar</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Iniciá sesión con tu cuenta de Google.
        </p>
      </div>

      <LoginButton next={next} />

      {error === "unauthorized" && (
        <p className="text-sm text-red-600">
          Tu cuenta no está autorizada. Contactá a un administrador.
        </p>
      )}
    </main>
  );
}
