import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// TRUST MODEL: admin-only behind the password middleware. With per-rep
// logins this needs an ownership check (reps undo only their own visits)
// — see the rep-app security contract in .claude/plans/feature-canvassing.md.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().rpc("undo_visit", { p_visit_id: Number(id) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
