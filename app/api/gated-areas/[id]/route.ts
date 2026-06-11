import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const STATUSES = ["suggested", "confirmed", "cleared"] as const;
type GatedStatus = (typeof STATUSES)[number];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Partial<{
    status: GatedStatus;
    name: string | null;
    notes: string | null;
  }> | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.name !== undefined) patch.name = body.name?.trim() || null;
  if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin()
    .from("gated_areas")
    .update(patch)
    .eq("id", id)
    .select("id, county, name, confidence, status, notes, source, created_at")
    .single();
  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ error: "area not found" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ area: data });
}
