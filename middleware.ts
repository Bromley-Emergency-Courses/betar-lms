import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicMiddlewarePath } from "@/lib/portal-access";
import { demoDataAllowed } from "@/lib/demo-mode";

export async function middleware(request: NextRequest) {
  const hasSupabaseEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!hasSupabaseEnv) {
    if (!demoDataAllowed()) {
      return new NextResponse("The LMS is temporarily unavailable. Please contact your administrator.", {
        status: 503,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
      });
    }
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (
    isPublicMiddlewarePath(pathname)
  ) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
