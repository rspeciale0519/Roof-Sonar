import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { tag_ids?: unknown } | null;
  if (
    !body ||
    !Array.isArray(body.tag_ids) ||
    body.tag_ids.some((x) => typeof x !== "number")
  ) {
    return NextResponse.json({ error: "tag_ids must be an array of numbers" }, { status: 400 });
  }
  const tagIds = body.tag_ids as number[];
  const propertyId = Number(id);
  const sb = supabaseAdmin();

  const { error: delError } = await sb.from("property_tags").delete().eq("property_id", propertyId);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  if (tagIds.length > 0) {
    const rows = tagIds.map((tag_id) => ({ property_id: propertyId, tag_id }));
    const { error: insError } = await sb.from("property_tags").insert(rows);
    if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });
  }

  const { data, error: selError } = await sb
    .from("property_tags")
    .select("tags(id, label)")
    .eq("property_id", propertyId);
  if (selError) return NextResponse.json({ error: selError.message }, { status: 500 });

  return NextResponse.json({ tags: (data ?? []).map((t) => t.tags) });
}
