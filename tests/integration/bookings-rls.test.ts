import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  cleanupBookings,
  cleanupClient,
  cleanupProject,
  createBookingRows,
  createClientRow,
  createProjectRow,
  createTestUser,
  createUserWithRole,
  deleteTestUser,
  signInClient,
} from "./helpers";

const password = "Test-password-123!";

/**
 * Feature 003 ships `bookings` read-only on purpose (plan.md §3.1): the calendar
 * needs to render bookings, but every write belongs to 004. These tests pin
 * that contract down, so whoever adds the write path in 004 sees them fail and
 * knows exactly what they are changing.
 */
describe("bookings RLS", () => {
  let admin: { id: string; email: string };
  let developer: { id: string; email: string };
  let roleless: { id: string; email: string };
  let clientId: string;
  let projectId: string;
  let bookingId: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminUser = await createUserWithRole(
      `bk-admin-${suffix}@example.com`,
      password,
      "admin",
    );
    const devUser = await createUserWithRole(
      `bk-dev-${suffix}@example.com`,
      password,
      "developer",
    );
    const pending = await createTestUser(`bk-none-${suffix}@example.com`, password);

    admin = { id: adminUser.id, email: adminUser.email! };
    developer = { id: devUser.id, email: devUser.email! };
    roleless = { id: pending.id, email: pending.email! };

    const clientRow = await createClientRow(`Cliente reservas ${suffix}`);
    clientId = clientRow.id;
    const project = await createProjectRow({
      name: `Proyecto reservas ${suffix}`,
      clientId,
      pmId: adminUser.id,
    });
    projectId = project.id;

    const [booking] = await createBookingRows([
      {
        projectId,
        devId: devUser.id,
        startsAt: "2026-08-05T12:00:00Z",
        endsAt: "2026-08-05T16:00:00Z",
      },
    ]);
    bookingId = booking!.id;
  });

  afterAll(async () => {
    try {
      await cleanupBookings([projectId]);
      await cleanupProject(projectId);
      await cleanupClient(clientId);
    } finally {
      await deleteTestUser(admin.id);
      await deleteTestUser(developer.id);
      await deleteTestUser(roleless.id);
    }
  });

  // Q-5 default (functional spec §11): the developer sees the global calendar
  // in read-only mode.
  it("lets any provisioned user read every booking", async () => {
    const client = await signInClient(developer.email, password);
    const { data, error } = await client.from("bookings").select("id").eq("id", bookingId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("hides bookings from a user with no role", async () => {
    const client = await signInClient(roleless.email, password);
    const { data } = await client.from("bookings").select("id").eq("id", bookingId);

    expect(data ?? []).toHaveLength(0);
  });

  it("blocks inserts even for an admin", async () => {
    const client = await signInClient(admin.email, password);
    const { error } = await client.from("bookings").insert({
      project_id: projectId,
      dev_id: developer.id,
      starts_at: "2026-08-06T12:00:00Z",
      ends_at: "2026-08-06T16:00:00Z",
    });

    expect(error).not.toBeNull();
  });

  it("blocks updates even for an admin", async () => {
    const client = await signInClient(admin.email, password);
    await client.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

    // Read back with service_role: RLS can filter a write into a silent no-op,
    // so the error alone is not proof — the row has to be untouched.
    const { data } = await adminClient()
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();
    expect(data?.status).toBe("approved");
  });

  it("blocks deletes even for an admin", async () => {
    const client = await signInClient(admin.email, password);
    await client.from("bookings").delete().eq("id", bookingId);

    const { data } = await adminClient().from("bookings").select("id").eq("id", bookingId);
    expect(data).toHaveLength(1);
  });

  it("enforces that a booking ends after it starts", async () => {
    const { error } = await adminClient().from("bookings").insert({
      project_id: projectId,
      dev_id: developer.id,
      starts_at: "2026-08-06T16:00:00Z",
      ends_at: "2026-08-06T12:00:00Z",
    });

    expect(error?.message).toMatch(/bookings_ends_after_starts/);
  });
});
