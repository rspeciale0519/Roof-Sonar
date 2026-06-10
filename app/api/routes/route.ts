import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("routes")
    .select("id, name, created_at, status, rep_id, sales_reps(name), route_stops(count)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const routes = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    status: r.status,
    rep_id: r.rep_id,
    rep_name: (r.sales_reps as unknown as { name: string } | null)?.name ?? null,
    stop_count: (r.route_stops as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
  return NextResponse.json({ routes });
}

/** Save a named route: body { name, property_ids: number[], rep_id?: number } in stop order. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { name?: string; property_ids?: number[]; rep_id?: number }
    | null;
  if (!body?.name?.trim() || !body.property_ids?.length) {
    return NextResponse.json({ error: "name and property_ids required" }, { status: 400 });
  }
  const sb = supabaseAdmin();
  const { data: dnk } = await sb
    .from("properties")
    .select("id, situs_address")
    .in("id", body.property_ids)
    .eq("do_not_knock", true);
  if (dnk?.length) {
    return NextResponse.json(
      { error: `Do-Not-Knock properties cannot be routed: ${dnk.map((d) => d.situs_address).join("; ")}` },
      { status: 422 }
    );
  }
  const { data: route, error } = await sb
    .from("routes")
    .insert({ name: body.name.trim(), rep_id: body.rep_id ?? null, status: body.rep_id ? "assigned" : "draft" })
    .select("id")
    .single();
  if (error || !route) return NextResponse.json({ error: error?.message }, { status: 500 });

  const stops = body.property_ids.map((property_id, i) => ({ route_id: route.id, property_id, stop_order: i + 1 }));
  const { error: stopsError } = await sb.from("route_stops").insert(stops);
  if (stopsError) {
    await sb.from("routes").delete().eq("id", route.id);
    return NextResponse.json({ error: stopsError.message }, { status: 500 });
  }
  if (body.rep_id) await sb.from("route_assignments").insert({ route_id: route.id, rep_id: body.rep_id });
  return NextResponse.json({ id: route.id });
}
