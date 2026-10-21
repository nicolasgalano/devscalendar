import { describe, expect, it } from "vitest";

import { setProjectActiveSchema } from "@/lib/validation/projects";

/**
 * Feature 028 — T1.7. El schema del body del endpoint POST
 * `/api/projects/[id]/active`. Es chico; el valor está en no dejar que crezca.
 */
describe("setProjectActiveSchema", () => {
  it("accepts { active: true }", () => {
    expect(setProjectActiveSchema.safeParse({ active: true }).success).toBe(true);
  });

  it("accepts { active: false }", () => {
    expect(setProjectActiveSchema.safeParse({ active: false }).success).toBe(true);
  });

  it("rejects an empty object", () => {
    expect(setProjectActiveSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-boolean values for active", () => {
    expect(setProjectActiveSchema.safeParse({ active: "yes" }).success).toBe(false);
    expect(setProjectActiveSchema.safeParse({ active: 1 }).success).toBe(false);
    expect(setProjectActiveSchema.safeParse({ active: null }).success).toBe(false);
  });

  it("rejects a missing body", () => {
    expect(setProjectActiveSchema.safeParse(undefined).success).toBe(false);
  });
});
