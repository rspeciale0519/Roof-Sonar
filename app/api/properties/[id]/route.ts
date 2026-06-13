import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();

  const { data: property, error } = await sb
    .from("properties")
    .select(
      "id, situs_address, street_number, roof_year, year_built, roofing_squares, squares_source, owner_name, " +
      "owner_mailing_address, occupancy, homestead, last_permit_number, last_permit_date, do_not_knock, " +
      "dor_use_code, jurisdictions(name)"
    )
    .eq("id", id)
    .single();
  if (error || !property) return NextResponse.json({ error: "property not found" }, { status: 404 });

  const [{ data: visits }, { data: notes }, { data: tags }, { data: routes }] = await Promise.all([
    sb.from("visits")
      .select("id, pin_type_id, note, knocked_at, rep_id, sales_reps(name), pin_types(label, color)")
      .eq("property_id", id)
      .order("knocked_at", { ascending: false }),
    sb.from("property_notes")
      .select("id, body, created_at, sales_reps(name)")
      .eq("property_id", id)
      .order("created_at", { ascending: false }),
    sb.from("property_tags").select("tags(id, label)").eq("property_id", id),
    sb.from("route_stops")
      .select("routes(id, name, status, sales_reps(name))")
      .eq("property_id", id),
  ]);

  return NextResponse.json({
    property,
    visits: (visits ?? []).map((v) => ({
      id: v.id,
      pin_type_id: v.pin_type_id,
      pin_label: (v.pin_types as unknown as { label: string }).label,
      pin_color: (v.pin_types as unknown as { color: string }).color,
      rep_id: v.rep_id,
      rep_name: (v.sales_reps as unknown as { name: string } | null)?.name ?? null,
      note: v.note,
      knocked_at: v.knocked_at,
    })),
    notes: (notes ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      created_at: n.created_at,
      rep_name: (n.sales_reps as unknown as { name: string } | null)?.name ?? null,
    })),
    tags: (tags ?? []).map((t) => t.tags),
    routes: (routes ?? []).map((r) => r.routes).filter((r): r is NonNullable<typeof r> => r != null),
  });
}
