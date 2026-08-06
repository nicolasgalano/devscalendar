import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * El calendario es la pantalla principal (spec funcional §4). La home de
 * bienvenida que vivía acá era un placeholder de `002`, mientras esa pantalla
 * no existía.
 *
 * La sesión y el rol ya los resolvió `(app)/layout.tsx`: si llegaste hasta acá,
 * estás autenticado y activo. Por eso este archivo no repite ningún chequeo.
 */
export default function HomePage() {
  redirect("/calendar");
}
