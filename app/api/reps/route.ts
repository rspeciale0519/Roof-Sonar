import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const includeInactive = req.nextUrl.searchParams.get("all") === "1";
  let q = supabaseAdmin().from("sales_reps").select("*").order("name");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reps: data });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { name?: string; phone?: string; email?: string } | null;
  if (!body?.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from("sales_reps")
    .insert({ name: body.name.trim(), phone: body.phone || null, email: body.email || null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rep: data });
}
