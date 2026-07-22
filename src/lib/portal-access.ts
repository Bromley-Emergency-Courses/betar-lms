export type PortalActorType = "applicant" | "student";
export type RouteAuthBoundary = "public" | "portal" | "staff";

const publicPathPrefixes = ["/login", "/apply"];
const publicApiPaths = ["/api/exam-adapters/results", "/api/exam-adapters/contract"];
const publicAssetPrefixes = ["/_next", "/favicon"];

function isPathOrChild(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function routeAuthBoundaryForPath(pathname: string): RouteAuthBoundary {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";

  if (
    publicAssetPrefixes.some((prefix) => pathOnly.startsWith(prefix)) ||
    publicApiPaths.includes(pathOnly) ||
    publicPathPrefixes.some((prefix) => isPathOrChild(pathOnly, prefix))
  ) {
    return "public";
  }

  if (isPathOrChild(pathOnly, "/portal")) {
    return "portal";
  }

  return "staff";
}

export function isPublicMiddlewarePath(pathname: string): boolean {
  return routeAuthBoundaryForPath(pathname) === "public";
}

export function safePortalNextPath(value?: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/portal";
  }

  return routeAuthBoundaryForPath(value) === "staff" ? "/portal" : value;
}

export function portalSignInPath(next?: string | null): string {
  return `/apply/login?next=${encodeURIComponent(safePortalNextPath(next))}`;
}
