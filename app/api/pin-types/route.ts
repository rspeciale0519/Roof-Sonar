import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const includeArchived = req.nextUrl.searchParams.get("all") === "1";
  let q = supabaseAdmin().from("pin_types").select("*").order("sort_order").order("id");
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pin_types: data });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<{
    label: string; color: string; icon: string; expires_after_days: number | null;
    is_do_not_knock: boolean; counts_as_contact: boolean; counts_as_lead: boolean; sort_order: number;
  }> | null;
  if (!body?.label?.trim()) return NextResponse.json({ error: "label required" }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from("pin_types")
    .insert({
      label: body.label.trim(),
      color: body.color ?? "#f97316",
      icon: body.icon ?? null,
      expires_after_days: body.expires_after_days ?? null,
      is_do_not_knock: body.is_do_not_knock ?? false,
      counts_as_contact: body.counts_as_contact ?? true,
      counts_as_lead: body.counts_as_lead ?? false,
      sort_order: body.sort_order ?? 99,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pin_type: data });
}
