import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse("APP_PASSWORD is not configured", { status: 503 });
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && timingSafeEqual(cookie, await sessionToken(password))) {
    return NextResponse.next();
  }
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Gate everything except the login page/endpoint and static assets.
  matcher: ["/((?!login|api/auth/login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
