import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDraft,
  DRAFT_TTL_MS,
  readDraft,
  writeDraft,
} from "@/lib/time-entries/draft-storage";

// El proyecto unit corre en `environment: "node"` (vitest.config.ts) — no hay
// jsdom. Shimeo lo mínimo del Storage API para que `draft-storage` encuentre
// `window.localStorage`. El helper es SSR-safe pero chequea `typeof window`,
// así que exponer un `window` global le alcanza.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
  };
}

const originalWindow = (globalThis as { window?: unknown }).window;
(globalThis as { window: { localStorage: Storage } }).window = {
  localStorage: makeMemoryStorage(),
};

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("draft-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("round-trips a value for the same user + key", () => {
    writeDraft("foo", "user-1", { a: 1, b: "two" });
    expect(readDraft<{ a: number; b: string }>("foo", "user-1")).toEqual({
      a: 1,
      b: "two",
    });
  });

  it("isolates values across users (shared machine)", () => {
    writeDraft("foo", "user-1", { secret: "hello" });
    expect(readDraft("foo", "user-2")).toBeNull();
  });

  it("returns null when the stored draft is older than the TTL", () => {
    vi.useFakeTimers();
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(start);
    writeDraft("foo", "user-1", { x: 1 });
    // Avanzamos justo pasado el TTL.
    vi.setSystemTime(start + DRAFT_TTL_MS + 1);
    expect(readDraft("foo", "user-1")).toBeNull();
    // Y debería haber borrado la entry — una segunda lectura ya no la trae.
    vi.setSystemTime(start + DRAFT_TTL_MS + 100);
    expect(window.localStorage.getItem("foo:user-1")).toBeNull();
  });

  it("keeps values younger than the TTL", () => {
    vi.useFakeTimers();
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(start);
    writeDraft("foo", "user-1", { x: 1 });
    vi.setSystemTime(start + DRAFT_TTL_MS - 1_000);
    expect(readDraft("foo", "user-1")).toEqual({ x: 1 });
  });

  it("clearDraft removes the entry", () => {
    writeDraft("foo", "user-1", { x: 1 });
    clearDraft("foo", "user-1");
    expect(readDraft("foo", "user-1")).toBeNull();
  });

  it("returns null for garbled JSON in localStorage without throwing", () => {
    window.localStorage.setItem("bar:user-1", "{not-json");
    expect(() => readDraft("bar", "user-1")).not.toThrow();
    expect(readDraft("bar", "user-1")).toBeNull();
  });

  it("returns null when the envelope is missing writtenAt", () => {
    window.localStorage.setItem(
      "baz:user-1",
      JSON.stringify({ value: { x: 1 } }),
    );
    expect(readDraft("baz", "user-1")).toBeNull();
  });
});
