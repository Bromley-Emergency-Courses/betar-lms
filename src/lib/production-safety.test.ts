import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { demoDataAllowed } from "./demo-mode";
import { isSupabaseConfigured } from "./supabase";
import { getAppData } from "./seed";
import { getCurrentStaffProfile } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } })),
  createBrowserClient: vi.fn()
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("production data isolation", () => {
  it.each(["production", undefined, "preview"])("denies demo data and identities in %s", async environment => {
    vi.stubEnv("NODE_ENV", environment);
    expect(demoDataAllowed()).toBe(false);
    expect(() => getAppData()).toThrow("Demo data is disabled");
    expect(() => isSupabaseConfigured()).toThrow("Demo data is disabled");
    await expect(getCurrentStaffProfile()).rejects.toThrow("Demo data is disabled");
  });

  it.each(["development", "test"])("retains local demo mode in %s", async environment => {
    vi.stubEnv("NODE_ENV", environment);
    expect(demoDataAllowed()).toBe(true);
    expect(isSupabaseConfigured()).toBe(false);
    expect(getAppData().students.length).toBeGreaterThan(0);
    expect(await getCurrentStaffProfile()).toMatchObject({ id: "demo-admin" });
    expect((await middleware(new NextRequest("http://localhost/students"))).status).toBe(200);
  });

  it.each(["/students", "/staff?variant=A", "/login", "/portal", "/api/exams/sync"])("blocks unconfigured production requests to %s", async path => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await middleware(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toMatch(/demo-admin|student-1|supabase/i);
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("rejects partial production configuration: %s", async key => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(key, "configured");
    expect(() => isSupabaseConfigured()).toThrow("Demo data is disabled");
    expect((await middleware(new NextRequest("http://localhost/students"))).status).toBe(503);
  });

  it("uses real authentication, never demo identity, when production is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-unit-test-key");
    expect(isSupabaseConfigured()).toBe(true);
    expect(await getCurrentStaffProfile()).toBeNull();
    expect(() => getAppData()).toThrow("Demo data is disabled");
    expect((await middleware(new NextRequest("http://localhost/students"))).status).toBe(200);
  });
});
