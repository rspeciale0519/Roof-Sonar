import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    property_id?: number; pin_type_id?: number; rep_id?: number | null;
    route_id?: number | null; note?: string; lng?: number; lat?: number;
  } | null;
  if (!body?.property_id || !body.pin_type_id) {
    return NextResponse.json({ error: "property_id and pin_type_id required" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().rpc("record_visit", {
    p_property_id: body.property_id,
    p_pin_type_id: body.pin_type_id,
    p_rep_id: body.rep_id ?? null,
    p_route_id: body.route_id ?? null,
    p_note: body.note ?? null,
    p_lng: body.lng ?? null,
    p_lat: body.lat ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ visit_id: data });
}
