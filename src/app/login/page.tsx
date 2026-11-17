import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { LoginButton } from "./login-button";

export const dynamic = "force-dynamic";

type SearchParams = { next?: string; error?: string; code?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { next, error, code } = await searchParams;

  // Fallback defensivo (2026-11-17): si Supabase devuelve el PKCE code al
  // Site URL en lugar de al `redirectTo` (pasa cuando la Redirect Allow-List
  // del dashboard no incluye `/auth/callback`), redirigimos nosotros al
  // handler correcto en vez de dejar al user trabado en la pantalla de login
  // con `?code=<uuid>&next=%2F` sin feedback. Reportado por Emiliano después
  // de limpiar cookies — el flow de login quedaba mudo. El fix root cause
  // vive en el dashboard de Supabase; esto es la red.
  if (code) {
    const target = new URL("/auth/callback", "https://placeholder");
    target.searchParams.set("code", code);
    if (next) target.searchParams.set("next", next);
    redirect(`${target.pathname}?${target.searchParams.toString()}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-full max-w-80 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-title font-medium">WeDoWeb Workflow</h1>
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
