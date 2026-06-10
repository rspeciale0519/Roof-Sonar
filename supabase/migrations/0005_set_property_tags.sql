-- Atomic tag-set replacement (review follow-up): the API's delete-then-insert
-- could lose all tags when the insert failed after the delete committed.
create or replace function set_property_tags(p_property_id bigint, p_tag_ids int[])
returns void
language plpgsql
as $$
begin
  delete from property_tags where property_id = p_property_id;
  if array_length(p_tag_ids, 1) is not null then
    insert into property_tags (property_id, tag_id)
    select p_property_id, unnest(p_tag_ids)
    on conflict do nothing;
  end if;
end;
$$;
