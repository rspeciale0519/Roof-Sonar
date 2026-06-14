---
name: create-migration
description: Scaffold the next numbered Supabase migration following RoofRadar's conventions — idempotent DDL, normalized parcel matching with a covering index, and advance-only RPCs. Use when adding a schema change.
disable-model-invocation: true
---

# Create Migration

Creates the next `supabase/migrations/00NN_<desc>.sql` consistent with the existing migrations.

## Steps

1. **Find the next number.** List `supabase/migrations/*.sql`, take the max `NNNN`, add 1, zero-pad to 4. Name `00NN_<snake_case_description>.sql`.

2. **Write idempotent DDL.** Always guard:
   - `create table if not exists` / `alter table ... add column if not exists`
   - `create index if not exists`
   - `create or replace function` for RPCs
   - `drop ... if exists` before recreating.

3. **If it touches permit→property parcel matching**, normalize BOTH sides:
   `upper(regexp_replace(parcel_number, '[^A-Za-z0-9]', '', 'g'))` (see migration 0017), and add the covering functional index (see 0018):
   ```sql
   create index if not exists properties_parcel_norm_idx
     on properties (upper(regexp_replace(parcel_number,'[^A-Za-z0-9]','','g')))
     where parcel_number is not null;
   ```

4. **RPCs that set roof_year** must be advance-only (`greatest(roof_year, <new>)` / newest wins).

5. **New tables** — make an explicit RLS decision and include it.

6. **Review, then apply.** Run the `migration-reviewer` subagent. Production apply to project `conaysztofpjoqzoyrnp` is owner-gated — do not apply without explicit approval. Apply via the Management API query endpoint (`POST https://api.supabase.com/v1/projects/<ref>/database/query` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`); the `supabase db query` CLI subcommand does not exist in the installed CLI.
