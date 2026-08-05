import { createClient } from "@/lib/supabase/server";

import { ClientsTable } from "./clients-table";

export const dynamic = "force-dynamic";

export default async function AdminClientsPage() {
  const supabase = await createClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, active")
    .order("name");

  // §9: el estado de error se propaga al error boundary de la ruta.
  if (error) throw new Error(error.message);

  return <ClientsTable clients={clients ?? []} />;
}
