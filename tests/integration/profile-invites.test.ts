import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { adminClient, createTestUser, deleteTestUser } from "./helpers";

/**
 * T4.2 — feature 002. `handle_new_user` consulta `profile_invites` al crear el
 * profile: si hay match hereda el rol y consume la invitación; si no, cae al
 * comportamiento de 001 (rol nulo, pantalla /pending-access).
 */
describe("handle_new_user with profile_invites", () => {
  let userId: string | undefined;
  let invitedEmail: string | undefined;

  afterEach(async () => {
    if (userId) {
      await deleteTestUser(userId);
      userId = undefined;
    }
    if (invitedEmail) {
      await adminClient().from("profile_invites").delete().eq("email", invitedEmail);
      invitedEmail = undefined;
    }
  });

  it("gives the invited role to a profile created afterwards", async () => {
    const email = `invite-pm-${randomUUID()}@example.com`;
    invitedEmail = email;

    const { error: inviteError } = await adminClient()
      .from("profile_invites")
      .insert({ email, role: "pm" });
    expect(inviteError).toBeNull();

    const user = await createTestUser(email, "Test-password-123!");
    userId = user.id;

    const { data, error } = await adminClient()
      .from("profiles")
      .select("id, email, role, active")
      .eq("id", user.id)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ id: user.id, email, role: "pm", active: true });
  });

  it("consumes the invitation so it cannot be reused", async () => {
    const email = `invite-once-${randomUUID()}@example.com`;
    invitedEmail = email;

    await adminClient().from("profile_invites").insert({ email, role: "admin" });

    const user = await createTestUser(email, "Test-password-123!");
    userId = user.id;

    const { data, error } = await adminClient()
      .from("profile_invites")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("still creates a role-less profile when there is no invitation", async () => {
    const email = `invite-none-${randomUUID()}@example.com`;
    const user = await createTestUser(email, "Test-password-123!");
    userId = user.id;

    const { data, error } = await adminClient()
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    expect(error).toBeNull();
    expect(data?.role).toBeNull();
  });

  it("does not apply an invitation addressed to a different email", async () => {
    const invited = `invite-other-${randomUUID()}@example.com`;
    invitedEmail = invited;
    await adminClient().from("profile_invites").insert({ email: invited, role: "admin" });

    const user = await createTestUser(
      `invite-unrelated-${randomUUID()}@example.com`,
      "Test-password-123!",
    );
    userId = user.id;

    const { data } = await adminClient()
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    expect(data?.role).toBeNull();

    // La invitación ajena sigue intacta.
    const { data: stillThere } = await adminClient()
      .from("profile_invites")
      .select("email")
      .eq("email", invited)
      .maybeSingle();
    expect(stillThere?.email).toBe(invited);
  });
});
