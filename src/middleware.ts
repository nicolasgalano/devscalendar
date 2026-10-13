import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static files, images, and the notifications
    // dispatch endpoint — ese endpoint autentica con `CRON_SECRET` (bearer) y
    // lo invocan el cron de Vercel (sin cookies) y el fetch inline post-ticket;
    // dejarlo pasar por el middleware lo redirigía a /login (307) y el drenaje
    // nunca corría — por eso la cola de emails quedaba `pending` con 0 intentos.
    "/((?!_next/static|_next/image|favicon.ico|api/notifications/dispatch|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
