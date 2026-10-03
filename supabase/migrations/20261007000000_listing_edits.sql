-- Listing quality:
--  1. Only towns the app can place on the map are accepted (an unknown town used to break
--     distance calculations for every user).
--  2. Owners can edit a listing's details while no exchange on it is in progress.
--     Archive / restore and changing the end date stay allowed at any time.

-- ============================================================== 1. known towns only
-- Keep in sync with CITY in lib/data.ts. NOT VALID: enforced for new/edited rows only.
alter table public.listings drop constraint if exists listings_known_town;
alter table public.listings add constraint listings_known_town check (loc in (
  'Pukekohe', 'Hastings', 'Whangarei', 'Rotorua', 'Nelson', 'Hamilton', 'Auckland', 'Tauranga', 'Cambridge', 'Palmerston North'
)) not valid;

alter table public.listings drop constraint if exists listings_dates_in_order;
alter table public.listings add constraint listings_dates_in_order check (to_date >= from_date) not valid;

-- ============================================================== 2. owner edits
create or replace function public.listings_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
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

  -- Details (anything except archive and end date) are locked while an exchange is open.
  if (new.mat, new.loc, new.from_date, new.cond, new.qty, new.price, new.disp, new.chem, new.uses,
      new.use1, new.min_qty, new.max_qty, new.max_km, new.max_price, new.alt)
     is distinct from
     (old.mat, old.loc, old.from_date, old.cond, old.qty, old.price, old.disp, old.chem, old.uses,
      old.use1, old.min_qty, old.max_qty, old.max_km, old.max_price, old.alt)
  then
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
  end if;

  if new.to_date < new.from_date then raise exception 'End date must be on or after the start date'; end if;
  return new;
end $$;
