import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestUser, deleteTestUser, signInClient } from "./helpers";

describe("profiles RLS", () => {
  const password = "Test-password-123!";
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };

  beforeAll(async () => {
    const a = await createTestUser(`rls-a-${randomUUID()}@example.com`, password);
    const b = await createTestUser(`rls-b-${randomUUID()}@example.com`, password);
    userA = { id: a.id, email: a.email! };
    userB = { id: b.id, email: b.email! };
  });

  afterAll(async () => {
    await deleteTestUser(userA.id);
    await deleteTestUser(userB.id);
  });

  it("lets a user read their own profile", async () => {
    const client = await signInClient(userA.email, password);
    const { data, error } = await client
      .from("profiles")
      .select("id")
      .eq("id", userA.id)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(userA.id);
  });

  it("prevents a user from reading another user's profile", async () => {
    const client = await signInClient(userA.email, password);
    const { data, error } = await client
      .from("profiles")
      .select("id")
      .eq("id", userB.id)
      .maybeSingle();

    // RLS filters the row out silently — no permission error, just no row.
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
