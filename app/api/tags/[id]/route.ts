import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Partial<{ label: string; archived: boolean }> | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
    patch.label = label;
  }
  if (body.archived !== undefined) patch.archived = body.archived;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("tags").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tag: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { count } = await sb.from("property_tags").select("tag_id", { count: "exact", head: true }).eq("tag_id", id);
  if (count && count > 0) {
    const { error } = await sb.from("tags").update({ archived: true }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, archived: true });
  }
  const { error } = await sb.from("tags").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, archived: false });
}
