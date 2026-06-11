import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * Gated-community polygons (display only — routes never read these).
 * Map mode (default): ?bbox=… -> GeoJSON FeatureCollection of non-cleared areas.
 * Admin mode: ?list=1[&county=X][&status=Y] -> all rows incl. cleared, no geometry.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("list") === "1") {
    let sel = supabaseAdmin()
      .from("gated_areas")
      .select("id, county, name, confidence, status, notes, source, created_at")
      .order("county")
      .order("confidence")
      .order("id");
    const county = q.get("county");
    const status = q.get("status");
    if (county) sel = sel.eq("county", county);
    if (status) sel = sel.eq("status", status);
    const { data, error } = await sel;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ areas: data ?? [] });
  }

  const bbox = (q.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    return NextResponse.json({ error: "bbox=minLng,minLat,maxLng,maxLat required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().rpc("gated_areas_in_bbox", {
    min_lng: bbox[0],
    min_lat: bbox[1],
    max_lng: bbox[2],
    max_lat: bbox[3],
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { id: number; name: string | null; confidence: string; status: string; geojson: string }[];
  return NextResponse.json({
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      id: r.id,
      geometry: JSON.parse(r.geojson) as GeoJSON.Geometry,
      properties: { id: r.id, name: r.name, confidence: r.confidence, status: r.status },
    })),
  });
}
