-- Smarter matching: buyers can say which kinds (categories) of material they accept.
-- Empty / null = any kind. Run after 20261008000000_compliance_check.sql.

alter table public.listings
  add column if not exists accepts text[]
  check (accepts <@ array['fruit_veg', 'processing', 'crop_residue', 'spare_feed', 'animal_waste']);

-- Same edit rules as before, with `accepts` counted as a listing detail.
create or replace function public.listings_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare details_changed boolean;
begin
  if auth.uid() is null or current_setting('agrireuse.tx', true) = 'on' then return new; end if;

  -- Never editable by users: identity, ownership and the quantities exchanges manage.
  new.id := old.id;
  new.owner_id := old.owner_id;
  new.type := old.type;
  new.biz := old.biz;
  new.done := old.done;
  new.res := old.res;
  new.move_r := old.move_r;
  new.created_at := old.created_at;

  details_changed := (new.mat, new.loc, new.from_date, new.cond, new.qty, new.price, new.disp, new.chem, new.uses,
      new.use1, new.min_qty, new.max_qty, new.max_km, new.max_price, new.alt,
      new.category, new.suburb, new.answers, new.accepts)
     is distinct from
     (old.mat, old.loc, old.from_date, old.cond, old.qty, old.price, old.disp, old.chem, old.uses,
      old.use1, old.min_qty, old.max_qty, old.max_km, old.max_price, old.alt,
      old.category, old.suburb, old.answers, old.accepts);

  if details_changed then
    if exists (
      select 1 from public.transactions t
       where (t.supply_id = old.id or t.demand_id = old.id) and t.step < 6 and t.cx is null
    ) then
      raise exception 'This listing has an exchange in progress. Finish or cancel it before editing.';
    end if;
    if new.type = 'Supply' and new.qty < old.done - 1e-9 then
      raise exception 'Quantity can''t be less than the % t already exchanged', old.done;
    end if;
    if new.type = 'Demand' and new.min_qty > new.max_qty then
      raise exception 'Minimum quantity can''t be more than the maximum';
    end if;
    -- Changed details need a fresh declaration.
    if new.type = 'Supply' and new.category is not null then
      if new.declared_at is null then raise exception 'Tick the seller declaration to save changes'; end if;
      new.declared_at := now();
    end if;
  else
    new.compliance := old.compliance;
    new.declared_at := old.declared_at;
  end if;

  if new.to_date < new.from_date then raise exception 'End date must be on or after the start date'; end if;
  return new;
end $$;

-- Give the fictional seeded buyers realistic preferences (compost and biogas take any kind).
update public.listings set accepts = array['fruit_veg', 'processing']
 where owner_id is null and type = 'Demand' and use1 in ('worm farming', 'pig feed') and accepts is null;
update public.listings set accepts = array['spare_feed', 'crop_residue', 'fruit_veg']
 where owner_id is null and type = 'Demand' and use1 = 'feed' and accepts is null;
update public.listings set accepts = array['crop_residue']
 where owner_id is null and type = 'Demand' and use1 = 'firewood' and accepts is null;
