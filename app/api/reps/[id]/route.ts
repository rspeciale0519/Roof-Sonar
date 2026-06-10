import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Partial<{
    name: string; phone: string | null; email: string | null; active: boolean;
  }> | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    patch.name = name;
  }
  if (body.phone !== undefined) patch.phone = body.phone || null;
  if (body.email !== undefined) patch.email = body.email || null;
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("sales_reps").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rep: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin()
    .from("sales_reps")
    .update({ active: false })
    .eq("id", id)
    .select("id")
    .single();
  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ error: "rep not found" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "rep not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
