export type PortalActorType = "applicant" | "student";
export type RouteAuthBoundary = "public" | "portal" | "staff";

const localRedirectOrigin = "https://betar.local";
const unsafeRedirectCharacters = /[\\\u0000-\u001f\u007f]/;
const publicExactPaths = ["/login", "/apply", "/apply/login", "/auth/callback"];
const publicPathPrefixes = ["/login"];
const applicantAuthenticatedPathPrefixes = ["/apply"];
const portalApiPathPrefixes = ["/api/portal"];
const publicApiPaths = ["/api/exam-adapters/results", "/api/exam-adapters/contract"];
const publicAssetPrefixes = ["/_next", "/favicon"];

function isPathOrChild(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function routeAuthBoundaryForPath(pathname: string): RouteAuthBoundary {
  const rawPathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  const pathOnly = rawPathOnly.length > 1 ? rawPathOnly.replace(/\/+$/, "") : rawPathOnly;

  if (
    publicAssetPrefixes.some((prefix) => pathOnly.startsWith(prefix)) ||
    publicApiPaths.includes(pathOnly) ||
    publicExactPaths.includes(pathOnly) ||
    publicPathPrefixes.some((prefix) => isPathOrChild(pathOnly, prefix))
  ) {
    return "public";
  }

  if (
    isPathOrChild(pathOnly, "/portal") ||
    portalApiPathPrefixes.some((prefix) => isPathOrChild(pathOnly, prefix)) ||
    applicantAuthenticatedPathPrefixes.some((prefix) => isPathOrChild(pathOnly, prefix))
  ) {
    return "portal";
  }

  return "staff";
}

export function isPublicMiddlewarePath(pathname: string): boolean {
  return routeAuthBoundaryForPath(pathname) === "public";
}

export function safePortalNextPath(value?: string | null): string {
  if (!value || unsafeRedirectCharacters.test(value)) {
    return "/portal";
  }

  let parsed: URL;
  try {
    parsed = new URL(value, localRedirectOrigin);
  } catch {
    return "/portal";
  }

  if (parsed.origin !== localRedirectOrigin) {
    return "/portal";
  }

  const nextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return routeAuthBoundaryForPath(nextPath) === "staff" ? "/portal" : nextPath;
}

export function portalSignInPath(next?: string | null): string {
  return `/apply/login?next=${encodeURIComponent(safePortalNextPath(next))}`;
}
