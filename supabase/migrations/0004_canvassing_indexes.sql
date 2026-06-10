-- Review follow-ups for 0003: lookup indexes used by tag archive-vs-delete
-- checks and route assignment history reads.

create index if not exists property_tags_tag_idx on property_tags (tag_id);
create index if not exists route_assignments_route_idx on route_assignments (route_id);
