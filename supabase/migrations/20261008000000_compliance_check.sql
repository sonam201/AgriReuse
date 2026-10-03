-- Listing Compliance Check
--  * Supply listings store their category, suburb, question answers, the check result and
--    the seller's declaration ("saved record").
--  * New supply listings can't be published without a category and the declaration.
--  * A demo fruit fly zone (Papatoetoe) can be switched on/off live by any signed-in user.
--  * Listings in a fruit fly zone (declared, or in the active demo zone) can't start or
--    progress an exchange. Other rules (needs check / hidden uses) are applied by the app.

-- ============================================================== listing record
alter table public.listings
  add column if not exists category text check (category in ('fruit_veg', 'processing', 'crop_residue', 'spare_feed', 'animal_waste')),
  add column if not exists suburb text check (length(suburb) <= 60),
  add column if not exists answers jsonb not null default '{}',
  add column if not exists compliance jsonb,
  add column if not exists declared_at timestamptz;

-- ============================================================== demo zone switch
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles on delete set null
);
alter table public.app_settings enable row level security;

drop policy if exists "settings readable by signed-in users" on public.app_settings;
create policy "settings readable by signed-in users" on public.app_settings
  for select to authenticated using (true);
drop policy if exists "anyone signed in can toggle the demo zone" on public.app_settings;
create policy "anyone signed in can toggle the demo zone" on public.app_settings
  for update to authenticated using (key = 'demo_fruit_fly_zone') with check (key = 'demo_fruit_fly_zone');

insert into public.app_settings (key, value)
values ('demo_fruit_fly_zone', '{"active": false, "suburbs": ["Papatoetoe"]}')
on conflict (key) do nothing;

alter publication supabase_realtime add table public.app_settings;

-- True when a supply listing may not leave a fruit fly zone (declared by the seller,
-- or its suburb is in the active demo zone).
create or replace function public.in_fruit_fly_zone(s public.listings) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(s.answers ->> 'fruit_fly_zone', '') = 'yes'
      or exists (
        select 1 from public.app_settings a
         where a.key = 'demo_fruit_fly_zone'
           and coalesce((a.value ->> 'active')::boolean, false)
           and lower(trim(coalesce(s.suburb, ''))) in (select lower(x) from jsonb_array_elements_text(a.value -> 'suburbs') x)
      )
$$;

-- ============================================================== inserts: declaration required
create or replace function public.listings_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then return new; end if; -- seed scripts / service role
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'No profile for this user'; end if;
  if new.type = 'Supply' and not p.can_supply then
    raise exception 'Turn on selling in your Profile before listing supply';
  end if;
  if new.type = 'Demand' and not p.can_receive then
    raise exception 'Turn on buying in your Profile before posting a request';
  end if;
  if new.type = 'Supply' then
    if new.category is null then raise exception 'Choose a category for the listing'; end if;
    if new.declared_at is null then raise exception 'Tick the seller declaration before publishing'; end if;
    new.declared_at := now();
  end if;
  new.owner_id := auth.uid();
  new.biz := p.business_name;
  new.done := 0;
  new.res := 0;
  new.move_r := false;
  return new;
end $$;

-- ============================================================== edits: compliance fields too
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
      new.category, new.suburb, new.answers)
     is distinct from
     (old.mat, old.loc, old.from_date, old.cond, old.qty, old.price, old.disp, old.chem, old.uses,
      old.use1, old.min_qty, old.max_qty, old.max_km, old.max_price, old.alt,
      old.category, old.suburb, old.answers);

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

-- ============================================================== exchanges: fruit fly zone blocks
create or replace function public.start_transaction(p_supply text, p_demand text, p_q double precision) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.listings;
  d public.listings;
  new_id text;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into s from public.listings where id = p_supply and type = 'Supply' for update;
  select * into d from public.listings where id = p_demand and type = 'Demand';
  if s.id is null or d.id is null then raise exception 'Listing not found'; end if;
  if uid is distinct from s.owner_id and uid is distinct from d.owner_id then
    raise exception 'You can only start exchanges involving your own listings';
  end if;
  if s.owner_id = d.owner_id then raise exception 'You can''t trade with yourself'; end if;
  if s.arch or d.arch then raise exception 'Listing is archived'; end if;
  if s.move_r then raise exception 'Blocked: movement-restricted material'; end if;
  if public.in_fruit_fly_zone(s) then raise exception 'Not allowed: material in a fruit fly controlled area can''t leave the zone (MPI)'; end if;
  if public.needs_verification(s, d) then raise exception 'Blocked: verification required before an exchange'; end if;
  if p_q is null or p_q <= 0 or p_q > s.qty - s.done - s.res + 1e-9 then raise exception 'Exceeds available quantity'; end if;
  if p_q > d.max_qty + 1e-9 then raise exception 'Exceeds requested quantity'; end if;

  perform set_config('agrireuse.tx', 'on', true);
  update public.listings set res = round((res + p_q)::numeric, 3) where id = s.id;

  insert into public.transactions (supply_id, demand_id, supplier_id, receiver_id, proposer_id, q, price, log)
  values (s.id, d.id, s.owner_id, d.owner_id, uid, p_q, s.price,
          jsonb_build_array(jsonb_build_array('Review → terms proposed', to_char(now(), 'YYYY-MM-DD'))))
  returning id into new_id;

  perform public.notify(case when uid = s.owner_id then d.owner_id else s.owner_id end,
                        'New exchange proposed: ' || s.mat);
  return new_id;
end $$;

create or replace function public.advance_transaction(
  p_id text,
  p_co2 double precision default null,
  p_supplier_benefit double precision default null,
  p_receiver_benefit double precision default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  s public.listings;
  d public.listings;
  actor uuid;
  steps text[] := array['Terms agreed by both parties', 'Demo payment held', 'Pickup scheduled', 'Pickup confirmed',
                        'Receipt confirmed', 'Demo payment released', 'Completed'];
  nxt int;
begin
  select * into t from public.transactions where id = p_id for update;
  if t.id is null or not public.is_party(t, uid) then raise exception 'Transaction not found'; end if;
  if t.step >= 6 or t.cx is not null then raise exception 'Transaction already closed'; end if;
  nxt := t.step + 1;
  actor := public.step_actor(t, nxt);
  -- A null actor is a fictional seeded business: the real party simulates their step.
  if actor is not null and actor <> uid then
    raise exception 'Waiting for the other party to: %', steps[nxt + 1];
  end if;
  select * into s from public.listings where id = t.supply_id for update;
  select * into d from public.listings where id = t.demand_id;
  if s.move_r then raise exception 'Blocked by Safety Gate: movement-restricted material'; end if;
  if public.in_fruit_fly_zone(s) then raise exception 'Not allowed: material in a fruit fly controlled area can''t leave the zone (MPI)'; end if;
  if public.needs_verification(s, d) then raise exception 'Blocked by Safety Gate: verification required'; end if;

  update public.transactions
     set step = nxt,
         log = log || jsonb_build_array(jsonb_build_array(steps[nxt + 1], to_char(now(), 'YYYY-MM-DD'))),
         co2 = case when nxt = 6 then p_co2 else co2 end,
         supplier_benefit = case when nxt = 6 then p_supplier_benefit else supplier_benefit end,
         receiver_benefit = case when nxt = 6 then p_receiver_benefit else receiver_benefit end
   where id = t.id;

  if nxt = 6 then
    perform set_config('agrireuse.tx', 'on', true);
    update public.listings
       set res = round(greatest(res - t.q, 0)::numeric, 3), done = round((done + t.q)::numeric, 3)
     where id = s.id;
  end if;

  perform public.notify(case when uid = t.supplier_id then t.receiver_id else t.supplier_id end,
                        (case when nxt = 6 then 'Exchange completed: ' else steps[nxt + 1] || ': ' end) || s.mat);
end $$;

-- ============================================================== demo buyers for the new uses
-- Fictional buyers so the "hidden buyers" rules are visible (e.g. pig farmers hidden when
-- produce touched meat; only compost/biogas for rotting produce).
insert into public.listings (id, type, biz, mat, loc, from_date, to_date, use1, min_qty, max_qty, max_km, max_price, alt) values
  ('d41', 'Demand', 'Franklin Pig Farm (fictional)', 'Fruit and veg', 'Pukekohe', '2026-10-01', '2026-12-31', 'pig feed', 0.5, 4, 120, 20, 60),
  ('d42', 'Demand', 'Waikato Pork Co (fictional)', 'Fruit and veg', 'Hamilton', '2026-10-01', '2026-12-31', 'pig feed', 1, 5, 150, 25, 70),
  ('d43', 'Demand', 'Auckland BioEnergy (fictional)', 'Organic waste', 'Auckland', '2026-10-01', '2026-12-31', 'biogas', 0.5, 10, 150, 10, 40),
  ('d44', 'Demand', 'Waikato Digesters (fictional)', 'Organic waste', 'Hamilton', '2026-10-01', '2026-12-31', 'biogas', 1, 20, 200, 5, 35),
  ('d45', 'Demand', 'Bay Firewood Supplies (fictional)', 'Prunings', 'Tauranga', '2026-10-01', '2026-12-31', 'firewood', 0.5, 6, 200, 30, 90)
on conflict (id) do nothing;

-- Feed pathways (stock feed and the new pig feed) need simulated lab evidence first.
create or replace function public.needs_verification(s public.listings, d public.listings) returns boolean
language sql stable set search_path = '' as $$
  select (s.chem = 'unknown' or d.use1 in ('feed', 'pig feed'))
     and not exists (select 1 from public.verifications v where v.supply_id = s.id and v.demand_id = d.id)
$$;
