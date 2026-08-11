interface GeneratedMagicLinkProperties {
  hashed_token?: unknown;
  verification_type?: unknown;
}

const portalSignInVerificationTypes = new Set(["signup", "magiclink"]);

/**
 * Converts Supabase's admin-generated magic-link response into the app callback
 * URL used by the SSR auth flow. Supabase returns `signup` for the first magic
 * link issued to a new auth identity and `magiclink` for later sign-ins. Its
 * default action_link completes auth with URL-fragment tokens, which a server
 * route cannot read.
 */
export function portalMagicLinkCallbackUrl(
  data: unknown,
  redirectTo: string
): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const properties = (data as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") {
    return null;
  }

  const {
    hashed_token: tokenHash,
    verification_type: verificationType
  } = properties as GeneratedMagicLinkProperties;

  if (
    typeof tokenHash !== "string" ||
    tokenHash.length === 0 ||
    typeof verificationType !== "string" ||
    !portalSignInVerificationTypes.has(verificationType)
  ) {
    return null;
  }

  try {
    const callbackUrl = new URL(redirectTo);
    if (callbackUrl.protocol !== "http:" && callbackUrl.protocol !== "https:") {
      return null;
    }

    callbackUrl.hash = "";
    callbackUrl.searchParams.set("token_hash", tokenHash);
    callbackUrl.searchParams.set("type", verificationType);
    return callbackUrl.toString();
  } catch {
    return null;
  }
}
