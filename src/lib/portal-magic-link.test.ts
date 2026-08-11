import { describe, expect, it } from "vitest";
import { portalMagicLinkCallbackUrl } from "@/lib/portal-magic-link";

describe("portal magic-link callbacks", () => {
  it("builds an SSR-readable callback while preserving invitation proof", () => {
    const callbackUrl = portalMagicLinkCallbackUrl(
      {
        properties: {
          action_link: "https://supabase.example.test/auth/v1/verify#access_token=do-not-use",
          hashed_token: "hashed-auth-token",
          verification_type: "magiclink"
        }
      },
      "https://lms.example.test/auth/callback?next=%2Fapply%2Fapplication&invitation_id=invitation-1&claim_nonce=nonce-1"
    );

    expect(callbackUrl).not.toBeNull();
    const parsed = new URL(callbackUrl!);
    expect(parsed.origin).toBe("https://lms.example.test");
    expect(parsed.pathname).toBe("/auth/callback");
    expect(parsed.searchParams.get("next")).toBe("/apply/application");
    expect(parsed.searchParams.get("invitation_id")).toBe("invitation-1");
    expect(parsed.searchParams.get("claim_nonce")).toBe("nonce-1");
    expect(parsed.searchParams.get("token_hash")).toBe("hashed-auth-token");
    expect(parsed.searchParams.get("type")).toBe("magiclink");
    expect(callbackUrl).not.toContain("supabase.example.test");
    expect(parsed.hash).toBe("");
  });

  it("preserves Supabase's signup verification type for a first-time applicant", () => {
    const callbackUrl = portalMagicLinkCallbackUrl(
      {
        properties: {
          hashed_token: "first-contact-token",
          verification_type: "signup"
        }
      },
      "https://lms.example.test/auth/callback?next=%2Fapply%2Fapplication"
    );

    expect(callbackUrl).not.toBeNull();
    const parsed = new URL(callbackUrl!);
    expect(parsed.searchParams.get("token_hash")).toBe("first-contact-token");
    expect(parsed.searchParams.get("type")).toBe("signup");
  });

  it("rejects incomplete, unexpected, and unsafe generated-link data", () => {
    const redirectTo = "https://lms.example.test/auth/callback";

    expect(portalMagicLinkCallbackUrl(null, redirectTo)).toBeNull();
    expect(portalMagicLinkCallbackUrl({ properties: {} }, redirectTo)).toBeNull();
    expect(
      portalMagicLinkCallbackUrl(
        { properties: { hashed_token: "token", verification_type: "recovery" } },
        redirectTo
      )
    ).toBeNull();
    expect(
      portalMagicLinkCallbackUrl(
        { properties: { hashed_token: "token", verification_type: "magiclink" } },
        "javascript:alert(1)"
      )
    ).toBeNull();
  });
});
