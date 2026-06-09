import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.json({ error: "APP_PASSWORD not configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || !timingSafeEqual(body.password, password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
