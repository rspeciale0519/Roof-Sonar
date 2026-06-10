import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { body?: string; rep_id?: number | null } | null;
  if (!body?.body?.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("property_notes")
    .insert({ property_id: Number(id), body: body.body.trim(), rep_id: body.rep_id ?? null })
    .select("id, body, created_at, sales_reps(name)")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  return NextResponse.json({
    note: {
      id: data.id,
      body: data.body,
      created_at: data.created_at,
      rep_name: (data.sales_reps as unknown as { name: string } | null)?.name ?? null,
    },
  });
}
