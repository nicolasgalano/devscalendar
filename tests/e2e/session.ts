import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

config({ path: path.resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Role = "admin" | "pm" | "developer";

export type TestUser = {
  userId: string;
  email: string;
  password: string;
  fullName: string;
};

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Crea un usuario y le asigna el rol; no toca el navegador. */
export async function createUser(role: Role): Promise<TestUser> {
  const admin = serviceClient();
  const id = randomUUID();
  const email = `e2e-${role}-${id}@example.com`;
  const password = `E2e-password-${id}!`;
  // Único: los tests corren en paralelo y varios crean un PM a la vez, así que
  // un nombre compartido vuelve ambiguos los locators por texto.
  const fullName = `QA ${role} ${id.slice(0, 8)}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");

  const { error: roleError } = await admin
    .from("profiles")
    .update({ role, full_name: fullName })
    .eq("id", data.user.id);
  if (roleError) throw roleError;

  return { userId: data.user.id, email, password, fullName };
}

/**
 * El login real es Google OAuth, que no se puede automatizar acá. En su lugar
 * iniciamos sesión con contraseña contra GoTrue y plantamos la cookie con el
 * mismo formato que usa `@supabase/ssr` (`base64-` + JSON de la sesión en
 * base64url). Para la app es indistinguible de una sesión real.
 */
export async function authenticate(context: BrowserContext, user: TestUser) {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) throw error ?? new Error("signIn returned no session");

  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  const value =
    "base64-" + Buffer.from(JSON.stringify(data.session), "utf8").toString("base64url");

  await context.addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

export async function deleteUser(userId: string) {
  await serviceClient().auth.admin.deleteUser(userId);
}

/** Borra por nombre lo que haya creado un test, hijos primero. */
export async function cleanupByName(clientName: string, projectName?: string) {
  const admin = serviceClient();

  if (projectName) {
    const { data: project } = await admin
      .from("projects")
      .select("id")
      .eq("name", projectName)
      .maybeSingle();
    if (project) {
      await admin.from("audit_log").delete().eq("entity_id", project.id);
      await admin.from("projects").delete().eq("id", project.id);
    }
  }
  await admin.from("clients").delete().eq("name", clientName);
}

export async function deleteInvite(email: string) {
  await serviceClient().from("profile_invites").delete().eq("email", email);
}
