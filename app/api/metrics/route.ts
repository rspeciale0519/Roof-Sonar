import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get("days")) || 7));
  const { data, error } = await supabaseAdmin().rpc("rep_knock_stats", { p_days: days });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ days, stats: data });
}
