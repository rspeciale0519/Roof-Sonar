import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  const { data, error } = await supabaseAdmin().from("settings").select("*").order("id").limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ roof_slope_multiplier: Number(data?.roof_slope_multiplier ?? 1.3) });
}

/**
 * Update the slope multiplier, then recalculate roofing_squares across all
 * properties (PRD: Admin Settings Page) so the map reflects it immediately.
 */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { roof_slope_multiplier?: number } | null;
  const value = Number(body?.roof_slope_multiplier);
  if (!value || value < 1 || value > 2) {
    return NextResponse.json({ error: "roof_slope_multiplier must be between 1.00 and 2.00" }, { status: 400 });
  }
  const sb = supabaseAdmin();
  const { data: row } = await sb.from("settings").select("id").order("id").limit(1).maybeSingle();
  const { error } = row
    ? await sb.from("settings").update({ roof_slope_multiplier: value }).eq("id", row.id)
    : await sb.from("settings").insert({ roof_slope_multiplier: value });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: affected, error: rpcError } = await sb.rpc("recalculate_roofing_squares");
  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });
  return NextResponse.json({ roof_slope_multiplier: value, recalculated: affected ?? 0 });
}
