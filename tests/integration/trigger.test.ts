import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { adminClient, createTestUser, deleteTestUser } from "./helpers";

describe("handle_new_user trigger", () => {
  let userId: string | undefined;

  afterEach(async () => {
    if (userId) {
      await deleteTestUser(userId);
      userId = undefined;
    }
  });

  it("creates a matching profiles row when a new auth user is inserted", async () => {
    const email = `trigger-${randomUUID()}@example.com`;
    const user = await createTestUser(email, "Test-password-123!");
    userId = user.id;

    const { data, error } = await adminClient()
      .from("profiles")
      .select("id, email, role, active")
      .eq("id", user.id)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ id: user.id, email, role: null, active: true });
  });
});
