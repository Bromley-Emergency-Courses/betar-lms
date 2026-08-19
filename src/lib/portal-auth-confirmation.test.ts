import { describe, expect, it } from "vitest";
import {
  renderPortalAuthConfirmationPage,
  shouldConfirmPortalEmailCallback
} from "@/lib/portal-auth-confirmation";

describe("portal auth confirmation", () => {
  it("requires a confirmation step for email token callbacks", () => {
    expect(shouldConfirmPortalEmailCallback(new URLSearchParams("token_hash=token-1"))).toBe(true);
    expect(shouldConfirmPortalEmailCallback(new URLSearchParams("code=code-1"))).toBe(false);
  });

  it("preserves callback proof in hidden post fields", () => {
    const html = renderPortalAuthConfirmationPage(
      new URLSearchParams({
        next: "/apply/application",
        token_hash: "token-1",
        type: "magiclink",
        invitation_id: "invitation-1",
        claim_nonce: "nonce-1"
      })
    );

    expect(html).toContain('method="post" action="/auth/callback"');
    expect(html).toContain('name="next" value="/apply/application"');
    expect(html).toContain('name="token_hash" value="token-1"');
    expect(html).toContain('name="type" value="magiclink"');
    expect(html).toContain('name="invitation_id" value="invitation-1"');
    expect(html).toContain('name="claim_nonce" value="nonce-1"');
  });

  it("escapes callback values before rendering them into html", () => {
    const html = renderPortalAuthConfirmationPage(
      new URLSearchParams({
        token_hash: '" /><script>alert(1)</script>'
      })
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot; /&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
