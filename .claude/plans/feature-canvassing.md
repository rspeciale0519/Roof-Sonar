# Canvassing Operations (Reps, Pins, Tags, Visits) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git workflow (CLAUDE.md Rule 8):** run `/git-workflow-planning:start feature canvassing` before any code. After each phase: update the roadmap (Rule 7), then `/git-workflow-planning:checkpoint <N> <desc>`. After the last phase: `/git-workflow-planning:finish`.

**Goal:** Turn RoofSonar (formerly RoofRadar) from a lead-finding map into a canvassing ops tool: admin manages sales reps, assigns saved routes to them, and tracks per-door visit outcomes ("pins") with notes, tags, and knock metrics.

**Architecture:** One new migration adds reps / pin_types / tags / visits / property_notes / route assignment + lifecycle, an extended `properties_in_bbox` RPC (latest non-expired pin per property), and a `record_visit` RPC that atomically handles the DNK flag and route status. All data flows through service-role API routes behind the existing password middleware (same pattern as `/api/routes`). UI: three small admin CRUD pages, a pin tray on the map (arm pin → tap house), a pin layer above house labels, and a property modal (details, visit timeline, notes, tags).

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + PostGIS, service-role only), Mapbox GL JS 3, Tailwind 4, vitest (new — for pure lib logic).

**Terminology (locked):** A **Pin** is the per-visit outcome marker a rep drops on a house (Not Home, Interested, Do Not Knock…). A **Tag** is a reusable descriptive label attached to a property (Metal roof, Gated…). Both vocabularies are admin-managed; archive instead of delete when in use.

**Out of scope (future plan):** the rep-facing app, Supabase Auth roles, offline queueing, geostamped knocks (schema columns exist, nothing populates them yet).

**Security contract for the rep app (from automated security review, 2026-06-10):** today the app has ONE trust tier (shared APP_PASSWORD = admin), so `POST /api/visits` accepting `rep_id` from the body and unscoped `DELETE /api/visits/[id]` are by-design admin semantics. The moment per-rep logins exist these become vulnerabilities: (1) derive `rep_id` from the authenticated session, never the body; (2) gate undo_visit by ownership (rep may undo only their own recent visits) or admin role; (3) move route/property access behind RLS policies keyed to the session role. The rep-app plan MUST include these three items. Also: (4) the admin pin tray drops visits WITHOUT route_id (route-status auto-advancement never fires from this UI — fine for admin data entry); the rep app works FROM an assigned route and MUST pass route_id on every drop so in_progress/completed transitions work.

---

## File Structure

```
supabase/migrations/0003_canvassing.sql     CREATE: schema + RPCs + seeds
lib/types.ts                                MODIFY: PinType, Tag, SalesRep, Visit, PropertyNote, RouteStatus; extend MapProperty + SavedRoute
lib/canvassing.ts                           CREATE: nearestProperty() haversine snap (pure, tested)
lib/canvassing.test.ts                      CREATE: vitest tests
app/api/reps/route.ts                       CREATE: GET list / POST create
app/api/reps/[id]/route.ts                  CREATE: PATCH update / DELETE deactivate
app/api/pin-types/route.ts                  CREATE: GET / POST
app/api/pin-types/[id]/route.ts             CREATE: PATCH / DELETE (archive)
app/api/tags/route.ts                       CREATE: GET / POST
app/api/tags/[id]/route.ts                  CREATE: PATCH / DELETE (archive)
app/api/visits/route.ts                     CREATE: POST record_visit
app/api/visits/[id]/route.ts                CREATE: DELETE undo_visit
app/api/properties/[id]/route.ts            CREATE: GET modal payload (property, visits, notes, tags, routes)
app/api/properties/[id]/notes/route.ts      CREATE: POST add note
app/api/properties/[id]/tags/route.ts       CREATE: PUT replace tag set
app/api/routes/route.ts                     MODIFY: include rep/status; reject DNK stops
app/api/routes/[id]/route.ts                MODIFY: PATCH rep assignment
app/api/metrics/route.ts                    CREATE: GET rep_knock_stats
app/admin/page.tsx                          MODIFY: nav cards to sub-pages
app/admin/reps/page.tsx                     CREATE: reps CRUD
app/admin/pins/page.tsx                     CREATE: pin types CRUD
app/admin/tags/page.tsx                     CREATE: tags CRUD
app/admin/metrics/page.tsx                  CREATE: knock dashboard
components/property-modal.tsx               CREATE: details + timeline + notes + tags
components/pin-tray.tsx                     CREATE: bottom tag tray (arm/sticky/disarm + rep select)
components/map-view.tsx                     MODIFY: pin layer, pin-click → modal, armed-pin drop
components/map-app.tsx                      MODIFY: state wiring (armed pin, modal, undo toast)
package.json                                MODIFY: vitest + "test" script
```

Every source file stays under 450 LOC (CLAUDE.md). `map-view.tsx` is ~330 LOC; the additions below keep it ≤ 420. If it overflows during execution, extract the layer definitions into `components/map-layers.ts`.

---

## Phase 1 — Schema, types, test harness

### Task 1.1: vitest setup

**Files:** Modify `package.json`

- [ ] **Step 1:** `npm install -D vitest`
- [ ] **Step 2:** Add to `package.json` scripts: `"test": "vitest run"`
- [ ] **Step 3:** Run `npm run test` → expect "no test files found" exit 0 (vitest `--passWithNoTests` not needed; if it exits 1, add `"test": "vitest run --passWithNoTests"`).

### Task 1.2: Migration 0003

**Files:** Create `supabase/migrations/0003_canvassing.sql`

- [ ] **Step 1:** Write the migration exactly as below.

```sql
-- Canvassing: sales reps, pin/tag vocabularies, visit events, notes,
-- route assignment + lifecycle. Pins = per-visit outcome markers;
-- tags = reusable property labels. Both admin-managed, archive-not-delete.

create table if not exists sales_reps (
  id         bigserial primary key,
  name       text not null,
  phone      text,
  email      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists pin_types (
  id                 serial primary key,
  label              text not null unique,
  color              text not null default '#f97316',
  icon               text,                       -- lucide icon name (admin UI chip)
  expires_after_days int,                        -- null = never expires
  is_do_not_knock    boolean not null default false,
  counts_as_contact  boolean not null default true,
  counts_as_lead     boolean not null default false,
  archived           boolean not null default false,
  sort_order         int not null default 0
);

create table if not exists tags (
  id       serial primary key,
  label    text not null unique,
  archived boolean not null default false
);

create table if not exists visits (
  id           bigserial primary key,
  property_id  bigint not null references properties (id) on delete cascade,
  route_id     bigint references routes (id) on delete set null,
  rep_id       bigint references sales_reps (id),
  pin_type_id  int not null references pin_types (id),
  note         text,
  knocked_at   timestamptz not null default now(),
  knock_lng    double precision,   -- future rep app geostamp
  knock_lat    double precision
);

create index if not exists visits_property_latest_idx on visits (property_id, knocked_at desc);
create index if not exists visits_rep_idx on visits (rep_id, knocked_at desc);
create index if not exists visits_route_idx on visits (route_id);

create table if not exists property_notes (
  id          bigserial primary key,
  property_id bigint not null references properties (id) on delete cascade,
  rep_id      bigint references sales_reps (id),   -- null = admin
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists property_notes_property_idx on property_notes (property_id, created_at desc);

create table if not exists property_tags (
  property_id bigint not null references properties (id) on delete cascade,
  tag_id      int not null references tags (id) on delete cascade,
  primary key (property_id, tag_id)
);

create table if not exists route_assignments (
  id          bigserial primary key,
  route_id    bigint not null references routes (id) on delete cascade,
  rep_id      bigint not null references sales_reps (id),
  assigned_at timestamptz not null default now()
);

alter table routes add column if not exists rep_id bigint references sales_reps (id);
alter table routes add column if not exists status text not null default 'draft'
  check (status in ('draft', 'assigned', 'in_progress', 'completed'));

alter table properties add column if not exists do_not_knock boolean not null default false;

alter table sales_reps        enable row level security;
alter table pin_types         enable row level security;
alter table tags              enable row level security;
alter table visits            enable row level security;
alter table property_notes    enable row level security;
alter table property_tags     enable row level security;
alter table route_assignments enable row level security;

-- Seed pin vocabulary (admin can edit later)
insert into pin_types (label, color, icon, expires_after_days, is_do_not_knock, counts_as_contact, counts_as_lead, sort_order) values
  ('Not Home',           '#9ca3af', 'door-closed',    14,   false, false, false, 1),
  ('Not Interested',     '#ef4444', 'x-circle',       null, false, true,  false, 2),
  ('Interested',         '#22c55e', 'thumbs-up',      null, false, true,  true,  3),
  ('Appointment Set',    '#10b981', 'calendar-check', null, false, true,  true,  4),
  ('Callback Requested', '#eab308', 'phone',          null, false, true,  true,  5),
  ('Do Not Knock',       '#111827', 'ban',            null, true,  true,  false, 6)
on conflict (label) do nothing;

-- ---------------------------------------------------------------------------
-- record_visit: one atomic call per pin drop. Sets the property DNK flag and
-- advances route status (assigned -> in_progress -> completed).
-- ---------------------------------------------------------------------------
create or replace function record_visit(
  p_property_id bigint,
  p_pin_type_id int,
  p_rep_id      bigint default null,
  p_route_id    bigint default null,
  p_note        text default null,
  p_lng         double precision default null,
  p_lat         double precision default null
)
returns bigint
language plpgsql
as $$
declare
  v_id  bigint;
  v_dnk boolean;
  v_open int;
begin
  insert into visits (property_id, route_id, rep_id, pin_type_id, note, knock_lng, knock_lat)
  values (p_property_id, p_route_id, p_rep_id, p_pin_type_id, nullif(trim(p_note), ''), p_lng, p_lat)
  returning id into v_id;

  select is_do_not_knock into v_dnk from pin_types where id = p_pin_type_id;
  if v_dnk then
    update properties set do_not_knock = true, updated_at = now() where id = p_property_id;
  end if;

  if p_route_id is not null then
    update routes set status = 'in_progress'
    where id = p_route_id and status in ('draft', 'assigned');

    select count(*) into v_open
    from route_stops rs
    where rs.route_id = p_route_id
      and not exists (select 1 from visits v where v.route_id = p_route_id and v.property_id = rs.property_id);
    if v_open = 0 then
      update routes set status = 'completed' where id = p_route_id;
    end if;
  end if;

  return v_id;
end;
$$;

-- undo_visit: delete + recompute the DNK flag from remaining history.
create or replace function undo_visit(p_visit_id bigint)
returns void
language plpgsql
as $$
declare
  v_property bigint;
begin
  delete from visits where id = p_visit_id returning property_id into v_property;
  if v_property is not null then
    update properties p
    set do_not_knock = exists (
      select 1 from visits v join pin_types pt on pt.id = v.pin_type_id
      where v.property_id = p.id and pt.is_do_not_knock
    )
    where p.id = v_property;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- properties_in_bbox v2: adds do_not_knock + latest non-expired pin.
-- Return type changes => must drop first.
-- ---------------------------------------------------------------------------
drop function if exists properties_in_bbox(
  double precision, double precision, double precision, double precision,
  text[], text[], text[], int
);

create or replace function properties_in_bbox(
  min_lng        double precision,
  min_lat        double precision,
  max_lng        double precision,
  max_lat        double precision,
  jurisdictions_ text[] default null,
  age_buckets    text[] default null,
  occupancies    text[] default null,
  max_rows       int default 3000
)
returns table (
  id              bigint,
  lng             double precision,
  lat             double precision,
  situs_address   text,
  street_number   text,
  roof_year       int,
  year_built      int,
  roofing_squares int,
  owner_name      text,
  occupancy       text,
  jurisdiction    text,
  last_permit_date date,
  do_not_knock    boolean,
  pin_type_id     int,
  pin_label       text,
  pin_color       text,
  pin_knocked_at  timestamptz
)
language sql
stable
as $$
  select
    p.id,
    st_x(p.geom::geometry)  as lng,
    st_y(p.geom::geometry)  as lat,
    p.situs_address,
    p.street_number,
    p.roof_year,
    p.year_built,
    p.roofing_squares,
    p.owner_name,
    coalesce(p.occupancy, 'unknown') as occupancy,
    j.slug                  as jurisdiction,
    p.last_permit_date,
    p.do_not_knock,
    lp.pin_type_id,
    lp.label                as pin_label,
    lp.color                as pin_color,
    lp.knocked_at           as pin_knocked_at
  from properties p
  join jurisdictions j on j.id = p.jurisdiction_id
  left join lateral (
    select v.pin_type_id, v.knocked_at, pt.label, pt.color
    from visits v
    join pin_types pt on pt.id = v.pin_type_id
    where v.property_id = p.id
      and (pt.expires_after_days is null
           or v.knocked_at > now() - make_interval(days => pt.expires_after_days))
    order by v.knocked_at desc
    limit 1
  ) lp on true
  where p.geom is not null
    and p.geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and (jurisdictions_ is null or j.slug = any (jurisdictions_))
    and (occupancies is null or coalesce(p.occupancy, 'unknown') = any (occupancies))
    and (
      age_buckets is null
      or (
        case
          when p.roof_year is null then 'unknown'
          when extract(year from now())::int - p.roof_year <= 5  then '0-5'
          when extract(year from now())::int - p.roof_year <= 10 then '6-10'
          when extract(year from now())::int - p.roof_year <= 15 then '11-15'
          else '16+'
        end
      ) = any (age_buckets)
    )
  limit greatest(1, least(max_rows, 3000));
$$;

-- ---------------------------------------------------------------------------
-- rep_knock_stats: doors knocked / contacts / leads per rep over a window,
-- plus route assignment + completion counts.
-- ---------------------------------------------------------------------------
create or replace function rep_knock_stats(p_days int default 7)
returns table (
  rep_id           bigint,
  rep_name         text,
  doors_knocked    bigint,
  contacts         bigint,
  leads            bigint,
  routes_assigned  bigint,
  routes_completed bigint
)
language sql
stable
as $$
  select
    r.id   as rep_id,
    r.name as rep_name,
    count(v.id)                                  as doors_knocked,
    count(v.id) filter (where pt.counts_as_contact) as contacts,
    count(v.id) filter (where pt.counts_as_lead)    as leads,
    (select count(*) from routes rt where rt.rep_id = r.id)                          as routes_assigned,
    (select count(*) from routes rt where rt.rep_id = r.id and rt.status = 'completed') as routes_completed
  from sales_reps r
  left join visits v
    on v.rep_id = r.id and v.knocked_at > now() - make_interval(days => p_days)
  left join pin_types pt on pt.id = v.pin_type_id
  where r.active
  group by r.id, r.name
  order by doors_knocked desc;
$$;
```

- [ ] **Step 2:** Apply: load `SUPABASE_ACCESS_TOKEN` from `.env.local` into the env, then `npx supabase db push --linked --yes`. Expected: "Applying migration 0003_canvassing.sql… Finished".
- [ ] **Step 3:** Verify: `npx supabase db query "select count(*) from pin_types; select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('record_visit','undo_visit','rep_knock_stats')" --linked`. Expected: 6 pin types, 3 function names.
- [ ] **Step 4:** Smoke the RPC contract the map relies on: `npx supabase db query "select id, pin_label, do_not_knock from properties_in_bbox(-81.40,29.02,-81.28,29.15) limit 3" --linked`. Expected: rows with `pin_label` null (no visits yet), `do_not_knock` false.

### Task 1.3: Types

**Files:** Modify `lib/types.ts`

- [ ] **Step 1:** Extend `MapProperty` with the new RPC columns:

```ts
export interface MapProperty {
  id: number;
  lng: number;
  lat: number;
  situs_address: string;
  street_number: string | null;
  roof_year: number | null;
  year_built: number | null;
  roofing_squares: number | null;
  owner_name: string | null;
  occupancy: "owner" | "likely_owner" | "absentee" | "investor" | "unknown";
  jurisdiction: string;
  last_permit_date: string | null;
  do_not_knock: boolean;
  pin_type_id: number | null;
  pin_label: string | null;
  pin_color: string | null;
  pin_knocked_at: string | null;
}
```

- [ ] **Step 2:** Append the new domain types and extend `SavedRoute`:

```ts
export type RouteStatus = "draft" | "assigned" | "in_progress" | "completed";

export interface SavedRoute {
  id: number;
  name: string;
  created_at: string;
  stop_count?: number;
  status: RouteStatus;
  rep_id: number | null;
  rep_name: string | null;
}

export interface SalesRep {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export interface PinType {
  id: number;
  label: string;
  color: string;
  icon: string | null;
  expires_after_days: number | null;
  is_do_not_knock: boolean;
  counts_as_contact: boolean;
  counts_as_lead: boolean;
  archived: boolean;
  sort_order: number;
}

export interface Tag {
  id: number;
  label: string;
  archived: boolean;
}

export interface Visit {
  id: number;
  pin_type_id: number;
  pin_label: string;
  pin_color: string;
  rep_id: number | null;
  rep_name: string | null;
  route_id: number | null;
  note: string | null;
  knocked_at: string;
}

export interface PropertyNote {
  id: number;
  body: string;
  rep_name: string | null; // null = admin
  created_at: string;
}
```

- [ ] **Step 3:** `npx tsc --noEmit` — expect errors only where `MapProperty` literals are constructed without the new fields (the `/api/properties` route passes RPC rows through untyped, so likely zero errors). Fix any by adding the fields.

### Task 1.4: nearestProperty (TDD)

**Files:** Create `lib/canvassing.test.ts`, then `lib/canvassing.ts`

- [ ] **Step 1:** Write the failing test:

```ts
import { describe, expect, it } from "vitest";
import { nearestProperty } from "./canvassing";

const prop = (id: number, lng: number, lat: number) =>
  ({ id, lng, lat }) as Parameters<typeof nearestProperty>[0][number];

describe("nearestProperty", () => {
  // ~1e-4 deg latitude ≈ 11.1 m
  it("returns the closest property within maxMeters", () => {
    const props = [prop(1, -81.344, 29.0711), prop(2, -81.3445, 29.0715)];
    expect(nearestProperty(props, -81.34401, 29.07111, 30)?.id).toBe(1);
  });
  it("returns null when nothing is within maxMeters", () => {
    const props = [prop(1, -81.344, 29.0711)];
    expect(nearestProperty(props, -81.344, 29.0741, 30)).toBeNull(); // ~333 m away
  });
  it("returns null for an empty list", () => {
    expect(nearestProperty([], -81.344, 29.0711, 30)).toBeNull();
  });
});
```

- [ ] **Step 2:** `npm run test` — expect FAIL ("Cannot find module './canvassing'").
- [ ] **Step 3:** Implement:

```ts
import type { MapProperty } from "./types";

const EARTH_M = 6371000;

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(a));
}

/** Snap a tap to the closest loaded property within maxMeters (wrong-house guard). */
export function nearestProperty(
  properties: Pick<MapProperty, "id" | "lng" | "lat">[],
  lng: number,
  lat: number,
  maxMeters: number
): Pick<MapProperty, "id" | "lng" | "lat"> | null {
  let best: Pick<MapProperty, "id" | "lng" | "lat"> | null = null;
  let bestD = Infinity;
  for (const p of properties) {
    const d = haversineMeters(lng, lat, p.lng, p.lat);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD <= maxMeters ? best : null;
}
```

- [ ] **Step 4:** `npm run test` — expect 3 passing.

### Phase 1 checkpoint

- [ ] Update the roadmap (Rule 7; if no roadmap file exists in `docs/`, ask the user whether to create one).
- [ ] `/git-workflow-planning:checkpoint 1 canvassing schema, types, test harness`

---

## Phase 2 — Reps, pin types, tags: APIs + admin pages

All API routes follow the existing pattern (`supabaseAdmin()`, JSON errors with status). The password middleware already covers `/api/*`.

### Task 2.1: Reps API

**Files:** Create `app/api/reps/route.ts`, `app/api/reps/[id]/route.ts`

- [ ] **Step 1:** `app/api/reps/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const includeInactive = req.nextUrl.searchParams.get("all") === "1";
  let q = supabaseAdmin().from("sales_reps").select("*").order("name");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reps: data });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { name?: string; phone?: string; email?: string } | null;
  if (!body?.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const { data, error } = await supabaseAdmin()
    .from("sales_reps")
    .insert({ name: body.name.trim(), phone: body.phone || null, email: body.email || null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rep: data });
}
```

- [ ] **Step 2:** `app/api/reps/[id]/route.ts` (PATCH updates name/phone/email/active; DELETE = deactivate, never hard-delete because visits reference reps):

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Partial<{
    name: string; phone: string | null; email: string | null; active: boolean;
  }> | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.phone !== undefined) patch.phone = body.phone || null;
  if (body.email !== undefined) patch.email = body.email || null;
  if (body.active !== undefined) patch.active = body.active;
  const { data, error } = await supabaseAdmin().from("sales_reps").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rep: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().from("sales_reps").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3:** Verify with the dev server running on port 3001 (3000 is taken by a Windows service): `curl -s -X POST http://localhost:3001/api/reps -H "Content-Type: application/json" -d '{"name":"Test Rep"}' -b "rr_auth=<cookie>"` — or simpler, verify from the browser console on the logged-in app: `fetch('/api/reps', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:'Test Rep'})}).then(r=>r.json())`. Expected: `{rep: {id: 1, name: "Test Rep", ...}}`.

### Task 2.2: Pin-types and tags APIs

**Files:** Create `app/api/pin-types/route.ts`, `app/api/pin-types/[id]/route.ts`, `app/api/tags/route.ts`, `app/api/tags/[id]/route.ts`

- [ ] **Step 1:** `app/api/pin-types/route.ts`:

```ts
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
```

- [ ] **Step 2:** `app/api/pin-types/[id]/route.ts` — PATCH passes through the same fields as POST (all optional); DELETE archives if any visit references it, hard-deletes otherwise:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const FIELDS = [
  "label", "color", "icon", "expires_after_days",
  "is_do_not_knock", "counts_as_contact", "counts_as_lead", "sort_order", "archived",
] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f];
  const { data, error } = await supabaseAdmin().from("pin_types").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pin_type: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { count } = await sb.from("visits").select("id", { count: "exact", head: true }).eq("pin_type_id", id);
  if (count && count > 0) {
    const { error } = await sb.from("pin_types").update({ archived: true }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, archived: true });
  }
  const { error } = await sb.from("pin_types").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, archived: false });
}
```

- [ ] **Step 3:** `app/api/tags/route.ts` and `app/api/tags/[id]/route.ts` — same shape as pin-types with only `label`/`archived` fields; DELETE archives when referenced in `property_tags`, hard-deletes otherwise. (Mirror the code above with table `tags`, reference check on `property_tags.tag_id`.)
- [ ] **Step 4:** Browser-console verify: `fetch('/api/pin-types').then(r=>r.json())` → 6 seeded pin types in sort order.

### Task 2.3: Admin pages

**Files:** Create `app/admin/reps/page.tsx`, `app/admin/pins/page.tsx`, `app/admin/tags/page.tsx`; modify `app/admin/page.tsx`

All three pages are `"use client"` CRUD tables following the visual language of `app/admin/page.tsx` (`rr-panel`, `rr-input`, `rr-btn rr-btn-primary`, `rr-chip`). Shape for each:

- Header row with `← Back to admin` link (`/admin`), icon, title.
- List of existing rows; inline edit on click; add-new form at the bottom.
- Errors surface in a `text-hot` paragraph, successes in `text-good` (same as admin page).

- [ ] **Step 1:** `app/admin/reps/page.tsx` — columns: name, phone, email, active toggle. Add form: name (required), phone, email. Deactivate button calls `DELETE /api/reps/[id]` and grays the row (when listing with `?all=1`).
- [ ] **Step 2:** `app/admin/pins/page.tsx` — columns: color swatch (native `<input type="color">`), label, expiry days (number, blank = never), three checkboxes (DNK / contact / lead), sort order. Add + edit via `POST /api/pin-types` and `PATCH /api/pin-types/[id]`. Delete button warns "in use → will be archived". Render each row's chip preview with its color so the admin sees what reps will see.
- [ ] **Step 3:** `app/admin/tags/page.tsx` — simplest: label list, add input, rename inline, archive button.
- [ ] **Step 4:** Modify `app/admin/page.tsx`: above the slope-multiplier panel, add a nav grid linking to the three new pages plus `/admin/metrics` (Phase 5):

```tsx
const ADMIN_LINKS = [
  { href: "/admin/reps", label: "Sales reps", icon: Users },
  { href: "/admin/pins", label: "Pin types", icon: MapPin },
  { href: "/admin/tags", label: "Tags", icon: TagIcon },
  { href: "/admin/metrics", label: "Knock metrics", icon: BarChart3 },
];
```

(`Users`, `MapPin`, `Tag as TagIcon`, `BarChart3` from `lucide-react`.) Render as a 2×2 grid of `rr-panel` link cards between the header and the multiplier panel.

- [ ] **Step 5:** Verify in the browser (chrome-devtools MCP, dev server on 3001): create a rep, create a pin type "Test Pin", rename a tag, archive it. Each action reflects after refresh.
- [ ] **Step 6:** `npx tsc --noEmit && npm run lint` — clean.

### Phase 2 checkpoint

- [ ] Update roadmap (Rule 7).
- [ ] `/git-workflow-planning:checkpoint 2 reps, pin and tag vocab admin`

---

## Phase 3 — Route assignment + lifecycle

### Task 3.1: Routes API

**Files:** Modify `app/api/routes/route.ts`, `app/api/routes/[id]/route.ts`

- [ ] **Step 1:** In `GET /api/routes`, change the select to include status + rep and map `rep_name`:

```ts
const { data, error } = await sb
  .from("routes")
  .select("id, name, created_at, status, rep_id, sales_reps(name), route_stops(count)")
  .order("created_at", { ascending: false });
// ...
const routes = (data ?? []).map((r) => ({
  id: r.id,
  name: r.name,
  created_at: r.created_at,
  status: r.status,
  rep_id: r.rep_id,
  rep_name: (r.sales_reps as unknown as { name: string } | null)?.name ?? null,
  stop_count: (r.route_stops as unknown as { count: number }[])?.[0]?.count ?? 0,
}));
```

- [ ] **Step 2:** In `POST /api/routes`, accept optional `rep_id` and enforce the DNK hard filter — silently dropping DNK stops is wrong; reject so the admin notices:

```ts
const body = (await req.json().catch(() => null)) as
  | { name?: string; property_ids?: number[]; rep_id?: number }
  | null;
// after the existing validation:
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
// after stops insert succeeds, when body.rep_id:
if (body.rep_id) await sb.from("route_assignments").insert({ route_id: route.id, rep_id: body.rep_id });
```

- [ ] **Step 3:** Add `PATCH` to `app/api/routes/[id]/route.ts` for (re)assignment:

```ts
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { rep_id?: number | null } | null;
  if (!body || body.rep_id === undefined) return NextResponse.json({ error: "rep_id required" }, { status: 400 });
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("routes")
    .update({ rep_id: body.rep_id, status: body.rep_id ? "assigned" : "draft" })
    .eq("id", id)
    .select("id, status, rep_id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (body.rep_id) await sb.from("route_assignments").insert({ route_id: Number(id), rep_id: body.rep_id });
  return NextResponse.json({ route: data });
}
```

### Task 3.2: Assignment UI

**Files:** Modify `components/selection-panel.tsx` (route save form), `components/filter-sidebar.tsx` (SAVED ROUTES list)

- [ ] **Step 1:** Read both components first; they were not modified by this plan's earlier tasks. In `selection-panel.tsx`, the save-route form gains a rep `<select>` (options from `GET /api/reps`, plus "Unassigned"), passed as `rep_id` in the existing POST body.
- [ ] **Step 2:** In `filter-sidebar.tsx`'s SAVED ROUTES section, each route row shows `rep_name ?? "Unassigned"` and a status chip colored by status (`draft` gray, `assigned` blue, `in_progress` amber, `completed` green), plus an "assign" dropdown that fires `PATCH /api/routes/[id]`.
- [ ] **Step 3:** Browser verify: save a 3-stop route assigned to "Test Rep" → appears with status `assigned`; reassign to another rep → `route_assignments` has 2 rows (`npx supabase db query "select * from route_assignments" --linked`).
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` — clean.

### Phase 3 checkpoint

- [ ] Update roadmap. `/git-workflow-planning:checkpoint 3 route assignment and lifecycle`

---

## Phase 4 — Property modal + pin layer (read path)

### Task 4.1: Property detail + notes + tags APIs

**Files:** Create `app/api/properties/[id]/route.ts`, `app/api/properties/[id]/notes/route.ts`, `app/api/properties/[id]/tags/route.ts`

- [ ] **Step 1:** `app/api/properties/[id]/route.ts` — one GET returning everything the modal needs:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();

  const { data: property, error } = await sb
    .from("properties")
    .select(
      "id, situs_address, street_number, roof_year, year_built, roofing_squares, owner_name, " +
      "owner_mailing_address, occupancy, homestead, last_permit_number, last_permit_date, do_not_knock, " +
      "jurisdictions(name)"
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
    routes: (routes ?? []).map((r) => r.routes),
  });
}
```

- [ ] **Step 2:** `notes/route.ts` — `POST { body, rep_id? }` inserts into `property_notes`, returns the row. Reject empty `body`.
- [ ] **Step 3:** `tags/route.ts` — `PUT { tag_ids: number[] }` replaces the set: delete all `property_tags` for the property, insert the new list. Return the resulting tag list.
- [ ] **Step 4:** Browser verify: `fetch('/api/properties/1').then(r=>r.json())` → property + empty arrays.

### Task 4.2: Property modal component

**Files:** Create `components/property-modal.tsx`; modify `components/map-app.tsx`

- [ ] **Step 1:** Build `property-modal.tsx` (`"use client"`). Props: `{ propertyId: number; onClose: () => void }`. On mount, fetch `/api/properties/[id]`, `/api/tags`, `/api/reps`. Layout (mobile-first, full-screen sheet on small viewports, centered card ≤ 560px on desktop, `rr-panel` styling, close ✕ top-right):
  - **Header:** street address bold; jurisdiction name; DNK banner (red, "Do Not Knock") when `do_not_knock`.
  - **Details grid (2-col):** roof year + age (use `roofAgeLabel`), year built, roofing squares, owner name, occupancy label (map via `OCCUPANCIES`), homestead, last permit # / date.
  - **Routes:** list of routes containing the property with status chip and rep name — answers "which rep was this given to".
  - **Tags:** chips for current tags; "+ Tag" opens the full tag list (most-used first comes later; alphabetical now), toggling fires `PUT .../tags`.
  - **Visit timeline:** newest-first rows — colored pin dot, pin label, rep name ?? "Admin", relative date, note text underneath.
  - **Notes:** list (author + date + body), textarea + "Add note" button → `POST .../notes` (admin context: `rep_id: null`), optimistic append.
- [ ] **Step 2:** In `map-app.tsx`, add `const [modalPropertyId, setModalPropertyId] = useState<number | null>(null)`, render `<PropertyModal>` when set, and pass `onOpenProperty={setModalPropertyId}` down to `MapView`.
- [ ] **Step 3:** `npx tsc --noEmit` — clean.

### Task 4.3: Pin layer on the map

**Files:** Modify `components/map-view.tsx`

- [ ] **Step 1:** In `toGeojson` (top of file), add the pin fields to feature properties: `pin_color: p.pin_color`, `has_pin: p.pin_type_id != null`, `dnk: p.do_not_knock`.
- [ ] **Step 2:** After the `property-selected` layer, add the visit-pin layer — a colored dot floating above the label block, visible at all fetch zooms:

```ts
map.addLayer({
  id: "visit-pins",
  type: "circle",
  source: "properties",
  filter: ["==", ["get", "has_pin"], true],
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], FETCH_ZOOM, 5, 19, 9],
    "circle-color": ["coalesce", ["get", "pin_color"], "#f97316"],
    "circle-stroke-width": 2,
    "circle-stroke-color": "#ffffff",
    "circle-translate": [0, -34],
    "circle-pitch-alignment": "map",
  },
});
map.addLayer({
  id: "dnk-marks",
  type: "symbol",
  source: "properties",
  filter: ["==", ["get", "dnk"], true],
  layout: { "text-field": "✕", "text-size": 12, "text-offset": [0, -5.4], "text-allow-overlap": true }, // raised to sit on the translated pin circle (Phase 4 review fix 8)
  paint: { "text-color": "#ffffff" },
});
```

- [ ] **Step 3:** In the existing `clickHandler`, check the pin layer first — a pin tap opens the modal instead of toggling selection:

```ts
const pinHit = map.queryRenderedFeatures(e.point, { layers: ["visit-pins"] })[0];
if (pinHit?.properties?.payload) {
  onOpenPropertyRef.current(
    (JSON.parse(pinHit.properties.payload as string) as MapProperty).id
  );
  return;
}
```

Wire `onOpenProperty` through props the same way `onToggle` flows today (prop → ref). Add `"visit-pins"` to the hover-cursor layer list.

- [ ] **Step 4:** Verify end-to-end with a hand-inserted visit:
  `npx supabase db query "select record_visit(1, 3)" --linked` (property 1, pin "Interested"), reload the map at the DeLand cluster (geolocate at `29.0711x-81.3440`, zoom to 16) → green-stroked pin dot floats above "1621"; tapping it opens the modal showing the Interested visit. Then clean up: `npx supabase db query "select undo_visit(<returned id>)" --linked`.
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint` — clean. Confirm `map-view.tsx` ≤ 450 LOC; if over, extract layer defs to `components/map-layers.ts`.

### Phase 4 checkpoint

- [ ] Update roadmap. `/git-workflow-planning:checkpoint 4 property modal and pin layer`

---

## Phase 5 — Pin drop flow (tray, snap, undo)

### Task 5.1: Visits API

**Files:** Create `app/api/visits/route.ts`, `app/api/visits/[id]/route.ts`

- [ ] **Step 1:** `app/api/visits/route.ts`:

```ts
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
```

- [ ] **Step 2:** `app/api/visits/[id]/route.ts` — DELETE calls `undo_visit`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().rpc("undo_visit", { p_visit_id: Number(id) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

### Task 5.2: Pin tray

**Files:** Create `components/pin-tray.tsx`; modify `components/map-app.tsx`, `components/map-view.tsx`

- [ ] **Step 1:** `pin-tray.tsx` — fixed bar at bottom-center of the map, horizontal scroll on narrow screens. Props:

```ts
interface PinTrayProps {
  pinTypes: PinType[];          // active, sorted
  reps: SalesRep[];
  armedPinId: number | null;    // sticky until explicitly disarmed
  onArm: (id: number | null) => void;
  actingRepId: number | null;   // "drop as" — null = Admin
  onActingRepChange: (id: number | null) => void;
}
```

Each pin renders as a large touch target (`min-h-11`, color dot + label). Armed pin gets a ring + the map cursor hint. An ✕ chip disarms (`onArm(null)`). A compact `<select>` on the right chooses the acting rep ("Admin" default). Touch-first sizing — this same component ships in the rep app later.

- [ ] **Step 2:** `map-app.tsx` — own the state: load pin types + reps once, hold `armedPinId`, `actingRepId`, and `undo` toast state `{ visitId, label, address } | null`. Implement the drop callback:

```ts
const handlePinDrop = async (propertyId: number, address: string) => {
  const pin = pinTypes.find((p) => p.id === armedPinId);
  if (!pin) return;
  const res = await fetch("/api/visits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ property_id: propertyId, pin_type_id: pin.id, rep_id: actingRepId }),
  });
  const json = await res.json();
  if (!res.ok) { setError(json.error); return; }
  setUndo({ visitId: json.visit_id, label: pin.label, address });
  refreshViewport();           // re-fetch so the new pin renders
  setTimeout(() => setUndo((u) => (u?.visitId === json.visit_id ? null : u)), 10000);
};
```

Undo toast (bottom, above tray): "Interested → 1621 GLENWOOD RD · **Undo**" — Undo fires `DELETE /api/visits/[id]`, clears the toast, refreshes the viewport. The armed pin stays armed after a drop (sticky by design — reps drop runs of the same pin).

- [ ] **Step 3:** `map-view.tsx` — in the click handler, when a pin is armed, snap-and-drop takes priority over everything:

```ts
if (armedPinRef.current != null) {
  const target = nearestProperty(propertiesRef.current, e.lngLat.lng, e.lngLat.lat, 30);
  if (target) {
    const full = propertiesRef.current.find((p) => p.id === target.id)!;
    onPinDropRef.current(full.id, full.situs_address);
  }
  return; // armed taps never toggle selection
}
```

(`armedPinId` and `onPinDrop` flow in as props mirrored into refs, same pattern as `onToggle`.) The 30 m `nearestProperty` snap is the wrong-house guard — taps on empty ground do nothing.

- [ ] **Step 4:** Browser verify the full loop at the DeLand cluster: arm "Not Home" → tap the 1621 house → gray pin appears above the label, undo toast shows the address; tap two more houses (pin stays armed); hit Undo on the last one → its pin disappears. Arm "Do Not Knock" → tap a house → `✕` mark renders; now try saving a route containing that house → API returns the 422 DNK error in the UI.
- [ ] **Step 5:** `npm run test && npx tsc --noEmit && npm run lint` — clean.

### Task 5.3: GPS follow-me mode

**Files:** Modify `components/map-view.tsx` (one control)

Reps walk neighborhoods with the phone in hand — the map must track their position continuously like Apple/Google Maps, not just one-shot center on demand.

- [ ] **Step 1:** Replace the current `GeolocateControl` construction (`map-view.tsx:91`, currently `trackUserLocation: false`) with:

```ts
map.addControl(
  new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserHeading: true,
    showAccuracyCircle: false,
  }),
  "bottom-right"
);
```

`trackUserLocation: true` makes the control a toggle: first tap centers + follows (camera pans as the user moves), pan-away switches to passive puck, re-tap resumes following. `showUserHeading` renders the direction cone on mobile (device orientation). Accuracy circle off — it reads as clutter over parcel pins at z16+.

- [ ] **Step 2:** Verify with chrome-devtools MCP: `emulate` geolocation at `29.0711x-81.3440`, click the geolocate control → map flies there and the control shows the active/tracking state; change emulated geolocation to `29.0720x-81.3440` → the camera follows to the new position without re-clicking. (Heading cone can't be emulated in desktop Chrome — confirm no console errors only.)
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` — clean.

### Phase 5 checkpoint

- [ ] Update roadmap. `/git-workflow-planning:checkpoint 5 pin tray drop flow with undo`

---

## Phase 6 — Knock metrics dashboard

### Task 6.1: Metrics API + page

**Files:** Create `app/api/metrics/route.ts`, `app/admin/metrics/page.tsx`

- [ ] **Step 1:** `app/api/metrics/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get("days")) || 7));
  const { data, error } = await supabaseAdmin().rpc("rep_knock_stats", { p_days: days });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ days, stats: data });
}
```

- [ ] **Step 2:** `app/admin/metrics/page.tsx` — window chips (Today=1 / 7 / 30 / 90 days) and a table: Rep · Doors knocked · Contacts (and rate = contacts/knocked) · Leads (and rate = leads/contacts) · Routes (completed/assigned). Plain numbers, `rr-panel` table, no chart library. Empty state: "No knocks recorded yet."
- [ ] **Step 3:** Verify: drop 3 pins as "Test Rep" (one Not Home, one Interested), open `/admin/metrics` → knocked 3, contacts 2, leads 1.
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint && npm run build` — clean build.

### Task 6.2: Mobile responsiveness pass

**Files:** Modify `components/filter-sidebar.tsx`, `components/map-app.tsx`, `components/selection-panel.tsx`, `components/pin-tray.tsx`, `components/property-modal.tsx`, `app/admin/*/page.tsx` (as needed)

Reps use phones (some tablets). Every rep-facing surface must work one-handed on a ~390px viewport; admin pages must be usable on a tablet. This is an audit-and-fix pass over everything this plan built:

- [ ] **Step 1: Map page on phones.** The fixed left sidebar currently eats a third of a phone screen. Below `md:` make it an overlay drawer: hidden by default, opened by a hamburger/filter button (top-left, ≥44px touch target), full-height, dismissible by tapping the map or an ✕. The houses-in-view counter stays visible in a compact top bar. Desktop (`md:`+) keeps the current docked panel.
- [ ] **Step 2: Pin tray on phones.** Bottom-fixed, horizontally scrollable, `min-h-11` (44px) touch targets, safe-area inset padding (`pb-[env(safe-area-inset-bottom)]`), and it must not overlap the undo toast (toast stacks above the tray) or Mapbox attribution.
- [ ] **Step 3: Property modal on phones.** Full-screen bottom sheet under `md:` (already specced in 4.2 — verify), body scrolls, close button reachable with a thumb, inputs ≥16px font (prevents iOS zoom-on-focus).
- [ ] **Step 4: Selection panel + saved routes on phones.** Verify the route-save form and route list are reachable and usable in the drawer layout from Step 1; rep `<select>` and buttons ≥44px.
- [ ] **Step 5: Admin pages on tablets/phones.** Nav cards 2×2 grid collapses to 1-col under `sm:`; CRUD tables stack or scroll horizontally without breaking layout; forms wrap.
- [ ] **Step 6: Verify with chrome-devtools `emulate` viewports:** `390x844x3,mobile,touch` (iPhone-class) and `820x1180x2,mobile,touch` (iPad-class) on: `/map` (drawer open/close, tray tap targets, modal sheet, pin drop flow), `/admin`, `/admin/reps`, `/admin/pins`, `/admin/metrics`. take_screenshot evidence at each breakpoint. Reset emulation afterward.
- [ ] **Step 7:** `npm run test && npx tsc --noEmit && npm run lint` — clean.
- [ ] **Step 8: Phase-2 review carry-overs (deferred to this pass):** per-row saving state instead of one global `saving` flag on admin CRUD pages; guard PATCH handlers against empty `{}` patch bodies (400 "no fields to update"); make `DELETE /api/reps/[id]` 404 on phantom ids (`.select().single()` after update); Enter-to-submit on the reps add form (tags already has it).

### Phase 6 checkpoint

- [ ] Update roadmap. `/git-workflow-planning:checkpoint 6 knock metrics dashboard`
- [ ] `/git-workflow-planning:finish`

---

## Self-review notes

- **Spec coverage:** reps CRUD (2.1/2.3) · route→rep with history (3.1/3.2) · pins on routed/visited houses (4.3) · modal with rep, details, notes (4.1/4.2) · admin add/modify/delete pins AND tags (2.2/2.3) · rep tagging-per-visit + notes (5.x, rep app itself deferred by agreement) · doors-knocked tracking (1.2 rep_knock_stats, 6.1) · bottom tray, arm-then-tap, sticky, tap-pin-for-modal (5.2/4.3) · DNK property flag + route hard-filter (1.2, 3.1) · visit history not status (visits table) · pin expiry (expires_after_days + lateral join) · undo (5.1/5.2) · wrong-house snap (1.4, 5.2).
- **Deferred consciously:** suggested-tags-by-usage ordering, per-rep daily goals, pin-type icon rendering on the map (color only for now), assignment notifications, route-status recompute self-heal (completion race + undo gap are best-effort; status is dashboard-only), per-row saving state on admin CRUD pages (global flag is acceptable for a small admin team).
- **Type consistency check:** `record_visit`/`undo_visit` signatures match API callers; `MapProperty` pin fields match RPC v2 columns; `PinTrayProps` matches map-app state names.
```
