import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

/** Re-open a saved route with full stop details, in stop order. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: route, error } = await sb.from("routes").select("id, name, created_at").eq("id", id).single();
  if (error || !route) return NextResponse.json({ error: "route not found" }, { status: 404 });

  const { data: stops, error: stopsError } = await sb
    .from("route_stops")
    .select(
      "stop_order, properties(id, situs_address, street_number, roof_year, year_built, roofing_squares, owner_name, occupancy, geom)"
    )
    .eq("route_id", id)
    .order("stop_order");
  if (stopsError) return NextResponse.json({ error: stopsError.message }, { status: 500 });

  // geom comes back as GeoJSON-ish; expose plain lng/lat for the client
  const detail = (stops ?? []).map((s) => {
    const p = s.properties as unknown as Record<string, unknown>;
    const geom = p.geom as { coordinates?: [number, number] } | null;
    return {
      stop_order: s.stop_order,
      id: p.id,
      situs_address: p.situs_address,
      street_number: p.street_number,
      roof_year: p.roof_year,
      year_built: p.year_built,
      roofing_squares: p.roofing_squares,
      owner_name: p.owner_name,
      occupancy: p.occupancy ?? "unknown",
      lng: geom?.coordinates?.[0] ?? null,
      lat: geom?.coordinates?.[1] ?? null,
    };
  });
  return NextResponse.json({ route, stops: detail });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().from("routes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
