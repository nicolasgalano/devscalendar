"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LoginButton({ next }: { next?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });

    if (oauthError) {
      setLoading(false);
      // §9: el detalle crudo va al log; en pantalla, qué pasó y qué hacer.
      console.error("OAuth start failed", oauthError);
      setError("No se pudo abrir el ingreso con Google. Probá de nuevo.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleClick} disabled={loading} className="w-full">
        {loading ? "Redirigiendo…" : "Continuar con Google"}
      </Button>
      {error && (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
