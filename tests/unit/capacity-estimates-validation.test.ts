import { describe, expect, it } from "vitest";

import { upsertCapacityEstimateSchema } from "@/lib/validation/capacity-estimates";

/**
 * Feature 029 — T1.7. El schema del body del endpoint POST
 * /api/capacity-estimates. Chico y acotado; los límites están para que una
 * malformación del cliente responda 400 legible en vez de pasar al Postgres
 * y volver con un 23514 opaco.
 */
describe("upsertCapacityEstimateSchema", () => {
  const validUuid = "11111111-1111-1111-1111-111111111111";
  const otherUuid = "22222222-2222-2222-2222-222222222222";

  it("accepts a well-formed payload", () => {
    const result = upsertCapacityEstimateSchema.safeParse({
      projectId: validUuid,
      devId: otherUuid,
      date: "2026-10-21",
      hours: 4,
    });
    expect(result.success).toBe(true);
  });

  it("accepts fractional hours (0.25 step comes from UI, not schema)", () => {
    const result = upsertCapacityEstimateSchema.safeParse({
      projectId: validUuid,
      devId: otherUuid,
      date: "2026-10-21",
      hours: 4.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects hours = 0 (upsert mandando 0 confundiría con delete)", () => {
    const result = upsertCapacityEstimateSchema.safeParse({
      projectId: validUuid,
      devId: otherUuid,
      date: "2026-10-21",
      hours: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects hours > 24", () => {
    const result = upsertCapacityEstimateSchema.safeParse({
      projectId: validUuid,
      devId: otherUuid,
      date: "2026-10-21",
      hours: 24.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative hours", () => {
    const result = upsertCapacityEstimateSchema.safeParse({
      projectId: validUuid,
      devId: otherUuid,
      date: "2026-10-21",
      hours: -4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date", () => {
    for (const date of ["2026/10/21", "21-10-2026", "2026-10", "today", ""]) {
      const result = upsertCapacityEstimateSchema.safeParse({
        projectId: validUuid,
        devId: otherUuid,
        date,
        hours: 4,
      });
      expect(result.success, `expected ${date} to be rejected`).toBe(false);
    }
  });

  it("rejects an invalid uuid for projectId or devId", () => {
    const r1 = upsertCapacityEstimateSchema.safeParse({
      projectId: "not-a-uuid",
      devId: otherUuid,
      date: "2026-10-21",
      hours: 4,
    });
    expect(r1.success).toBe(false);

    const r2 = upsertCapacityEstimateSchema.safeParse({
      projectId: validUuid,
      devId: "nope",
      date: "2026-10-21",
      hours: 4,
    });
    expect(r2.success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(upsertCapacityEstimateSchema.safeParse({}).success).toBe(false);
    expect(
      upsertCapacityEstimateSchema.safeParse({ projectId: validUuid, devId: otherUuid }).success,
    ).toBe(false);
  });

  it("rejects a missing body", () => {
    expect(upsertCapacityEstimateSchema.safeParse(undefined).success).toBe(false);
  });
});
