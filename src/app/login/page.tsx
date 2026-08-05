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
    <main className="mx-auto flex min-h-full max-w-80 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-title font-medium">DevsCalendar</h1>
        <p className="mt-0.5 text-ui text-muted-foreground">
          Iniciá sesión con tu cuenta de Google.
        </p>
      </div>

      <LoginButton next={next} />

      {error === "unauthorized" && (
        <p role="alert" className="text-ui text-destructive">
          Tu cuenta no está autorizada. Escribile a un administrador.
        </p>
      )}
    </main>
  );
}
