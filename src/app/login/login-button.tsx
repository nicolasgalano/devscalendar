"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function LoginButton({ next }: { next?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });

    if (error) {
      setLoading(false);
      // Bubble up to the user; a proper toast/logger comes with feature 010.
      console.error("OAuth start failed", error);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Redirigiendo..." : "Continuar con Google"}
    </button>
  );
}
