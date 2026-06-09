import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * Viewport loading (PRD: Map Display Spec). Called on map moveend with the
 * bbox + sidebar filters; delegates to the properties_in_bbox RPC (~3k cap).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const bbox = (q.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    return NextResponse.json({ error: "bbox=minLng,minLat,maxLng,maxLat required" }, { status: 400 });
  }
  const list = (name: string) => {
    const v = q.get(name);
    return v ? v.split(",") : null;
  };

  const { data, error } = await supabaseAdmin().rpc("properties_in_bbox", {
    min_lng: bbox[0],
    min_lat: bbox[1],
    max_lng: bbox[2],
    max_lat: bbox[3],
    jurisdictions_: list("jurisdictions"),
    age_buckets: list("ages"),
    occupancies: list("occupancies"),
    max_rows: 3000,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ properties: data ?? [] });
}
