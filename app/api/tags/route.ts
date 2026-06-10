import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const includeArchived = req.nextUrl.searchParams.get("all") === "1";
  let q = supabaseAdmin().from("tags").select("*").order("label");
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tags: data });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<{ label: string }> | null;
  if (!body?.label?.trim()) return NextResponse.json({ error: "label required" }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from("tags")
    .insert({ label: body.label.trim() })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tag: data });
}
