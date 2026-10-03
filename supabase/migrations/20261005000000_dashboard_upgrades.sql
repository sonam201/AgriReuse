-- Dashboard upgrades:
--  1. Store each side's money result when an exchange completes (like co2), so totals don't
--     shift when a viewer changes their logistics assumptions.
--  2. Owners may extend a listing's end date (as well as archive it).
--  3. Users may edit their business name and location, never their role; listing names follow.

-- ============================================================== 1. stored money results
alter table public.transactions
  add column if not exists supplier_benefit double precision,
  add column if not exists receiver_benefit double precision;

drop function if exists public.advance_transaction(text, double precision);

create function public.advance_transaction(
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

revoke execute on function public.advance_transaction(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.advance_transaction(text, double precision, double precision, double precision) to authenticated;

-- ============================================================== 2. extend listings
create or replace function public.listings_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  a boolean := new.arch;
  t date := new.to_date;
begin
  if auth.uid() is null or current_setting('agrireuse.tx', true) = 'on' then return new; end if;
  new := old;
  new.arch := a;
  if t is distinct from old.to_date then
    if t < old.from_date then raise exception 'End date must be after the start date'; end if;
    new.to_date := t;
  end if;
  return new;
end $$;

-- ============================================================== 3. editable profile
create or replace function public.profiles_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.role := old.role; -- account type is fixed
  new.created_at := old.created_at;
  if length(trim(new.business_name)) = 0 then raise exception 'Business name is required'; end if;
  new.business_name := trim(new.business_name);
  return new;
end $$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- Keep the business name shown on the user's listings in sync.
create or replace function public.profiles_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.business_name is distinct from old.business_name then
    perform set_config('agrireuse.tx', 'on', true);
    update public.listings set biz = new.business_name where owner_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists profiles_after_update on public.profiles;
create trigger profiles_after_update
  after update on public.profiles
  for each row execute function public.profiles_after_update();

