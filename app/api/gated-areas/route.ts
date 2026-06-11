import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * Gated-community polygons for the map overlay (display only — routes never
 * read these). Returns a GeoJSON FeatureCollection of non-cleared areas in
 * the bbox via the gated_areas_in_bbox RPC.
 */
export async function GET(req: NextRequest) {
  const bbox = (req.nextUrl.searchParams.get("bbox") ?? "").split(",").map(Number);
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
