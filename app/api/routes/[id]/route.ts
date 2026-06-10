import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { RouteStatus } from "@/lib/types";

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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const routeId = Number(id);
  const body = (await req.json().catch(() => null)) as { rep_id?: number | null } | null;
  if (!body || body.rep_id === undefined) return NextResponse.json({ error: "rep_id required" }, { status: 400 });
  const sb = supabaseAdmin();

  // Fix 1: preserve status for in_progress/completed routes on reassignment
  const { data: current } = await sb.from("routes").select("status").eq("id", id).single();
  const currentStatus = (current as { status: RouteStatus } | null)?.status;
  const preserveStatus = currentStatus === "in_progress" || currentStatus === "completed";
  const newStatus: RouteStatus = preserveStatus ? currentStatus : body.rep_id ? "assigned" : "draft";

  const { data, error } = await sb
    .from("routes")
    .update({ rep_id: body.rep_id, status: newStatus })
    .eq("id", id)
    .select("id, status, rep_id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fix 2 & 3: log history insert errors; use routeId (number) for the insert payload
  if (body.rep_id) {
    const { error: histErr } = await sb.from("route_assignments").insert({ route_id: routeId, rep_id: body.rep_id });
    if (histErr) console.error("route_assignments history insert failed:", histErr.message);
  }
  return NextResponse.json({ route: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().from("routes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
