-- AgriReuse schema: users (profiles with a fixed role), shared marketplace, transactions.
-- Listings with a null owner are seeded fictional businesses. In an exchange with one,
-- the real party may act on the fictional party's behalf (simulated counterparty) so the
-- demo still works with a single account.

-- ============================================================== profiles
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  business_name text not null check (length(trim(business_name)) > 0),
  role text not null check (role in ('Supplier', 'Receiver')),
  location text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, business_name, role, location)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''), 'New business'),
    coalesce(new.raw_user_meta_data ->> 'role', 'Supplier'),
    nullif(new.raw_user_meta_data ->> 'location', '')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================== listings
create table public.listings (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid references public.profiles on delete set null,
  type text not null check (type in ('Supply', 'Demand')),
  biz text not null,
  mat text not null,
  loc text not null,
  from_date date not null,
  to_date date not null,
  arch boolean not null default false,
  -- supply
  cond text,
  qty double precision check (qty > 0),
  price double precision,
  disp double precision,
  chem text check (chem in ('unknown', 'declared-none')),
  uses text[],
  done double precision not null default 0,
  res double precision not null default 0,
  move_r boolean not null default false,
  -- demand
  use1 text,
  min_qty double precision,
  max_qty double precision check (max_qty > 0),
  max_km double precision,
  max_price double precision,
  alt double precision,
  created_at timestamptz not null default now(),
  check (type <> 'Supply' or (qty is not null and price is not null and disp is not null and chem is not null and uses is not null)),
  check (type <> 'Demand' or (use1 is not null and min_qty is not null and max_qty is not null and max_km is not null and max_price is not null and alt is not null))
);

-- Inserts by users: owner and business name come from the caller's profile, and the
-- listing type must match the account role (Supplier -> Supply, Receiver -> Demand).
create function public.listings_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  allowed text;
begin
  if auth.uid() is null then return new; end if; -- seed scripts / service role
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'No profile for this user'; end if;
  allowed := case p.role when 'Supplier' then 'Supply' else 'Demand' end;
  if new.type <> allowed then
    raise exception '% accounts can only create % listings', p.role, allowed;
  end if;
  new.owner_id := auth.uid();
  new.biz := p.business_name;
  new.done := 0;
  new.res := 0;
  new.move_r := false;
  return new;
end $$;

create trigger listings_before_insert
  before insert on public.listings
  for each row execute function public.listings_before_insert();

-- Direct updates by users may only archive/restore. Quantities (res/done) change only
-- inside the transaction functions below, which set agrireuse.tx for the duration.
create function public.listings_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare a boolean := new.arch;
begin
  if auth.uid() is null or current_setting('agrireuse.tx', true) = 'on' then return new; end if;
  new := old;
  new.arch := a;
  return new;
end $$;

create trigger listings_before_update
  before update on public.listings
  for each row execute function public.listings_before_update();

-- ============================================================== transactions
create table public.transactions (
  id text primary key default gen_random_uuid()::text,
  supply_id text not null references public.listings on delete restrict,
  demand_id text not null references public.listings on delete restrict,
  supplier_id uuid references public.profiles on delete set null,
  receiver_id uuid references public.profiles on delete set null,
  proposer_id uuid references public.profiles on delete set null,
  q double precision not null check (q > 0),
  price double precision not null,
  step int not null default -1 check (step between -1 and 6),
  log jsonb not null default '[]',
  co2 double precision,
  cx text check (cx in ('cancelled', 'dispute')),
  created_at timestamptz not null default now()
);
create index on public.transactions (supplier_id);
create index on public.transactions (receiver_id);

-- ============================================================== verifications
create table public.verifications (
  supply_id text not null references public.listings on delete cascade,
  demand_id text not null references public.listings on delete cascade,
  verified_by uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (supply_id, demand_id)
);

-- ============================================================== notifications
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  txt text not null,
  read boolean not null default false,
  tab text not null,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- ============================================================== row level security
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.transactions enable row level security;
alter table public.verifications enable row level security;
alter table public.notifications enable row level security;

create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "users update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "listings readable by signed-in users" on public.listings
  for select to authenticated using (true);
create policy "users create listings" on public.listings
  for insert to authenticated with check (true); -- owner/type enforced by trigger
create policy "owners update listings" on public.listings
  for update to authenticated using (owner_id = auth.uid());
create policy "owners delete listings" on public.listings
  for delete to authenticated using (owner_id = auth.uid());

-- Completed exchanges are public (platform impact); others only to the parties involved.
create policy "transactions visible to parties or when completed" on public.transactions
  for select to authenticated
  using (step = 6 or auth.uid() in (supplier_id, receiver_id, proposer_id));

create policy "verifications readable by signed-in users" on public.verifications
  for select to authenticated using (true);
create policy "parties record verification" on public.verifications
  for insert to authenticated with check (
    verified_by = auth.uid() and exists (
      select 1 from public.listings l
      where l.id in (supply_id, demand_id) and l.owner_id = auth.uid()
    )
  );

create policy "users read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "users create own notifications" on public.notifications
  for insert to authenticated with check (user_id = auth.uid());
create policy "users update own notifications" on public.notifications
  for update to authenticated using (user_id = auth.uid());

-- ============================================================== transaction functions
-- Step index -> who performs it. 0 = terms agreed, done by whoever did NOT propose.
--   0 Terms agreed (non-proposer)  1 Payment held (receiver)   2 Pickup scheduled (supplier)
--   3 Pickup confirmed (supplier)  4 Receipt confirmed (receiver)
--   5 Payment released (receiver)  6 Completed (supplier)
create function public.step_actor(t public.transactions, next_step int) returns uuid
language sql immutable as $$
  select case
    when next_step = 0 then case when t.proposer_id = t.supplier_id then t.receiver_id else t.supplier_id end
    when next_step in (1, 4, 5) then t.receiver_id
    else t.supplier_id
  end
$$;

-- Null-safe: seeded fictional parties have null ids, so `uid in (...)` would yield null.
create function public.is_party(t public.transactions, uid uuid) returns boolean
language sql immutable as $$
  select uid is not null and (uid = t.supplier_id or uid = t.receiver_id or uid = t.proposer_id) is true
$$;

create function public.notify(uid uuid, msg text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, txt, tab)
  select uid, msg, 'Transactions' where uid is not null;
$$;
revoke execute on function public.notify(uuid, text) from public, anon, authenticated;

create function public.needs_verification(s public.listings, d public.listings) returns boolean
language sql stable set search_path = '' as $$
  select (s.chem = 'unknown' or d.use1 = 'feed')
     and not exists (select 1 from public.verifications v where v.supply_id = s.id and v.demand_id = d.id)
$$;

create function public.start_transaction(p_supply text, p_demand text, p_q double precision) returns text
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
  if s.arch or d.arch then raise exception 'Listing is archived'; end if;
  if s.move_r then raise exception 'Blocked: movement-restricted material'; end if;
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

create function public.advance_transaction(p_id text, p_co2 double precision default null) returns void
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
         co2 = case when nxt = 6 then p_co2 else co2 end
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

create function public.cancel_transaction(p_id text, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  mat text;
begin
  if p_kind not in ('cancelled', 'dispute') then raise exception 'Invalid kind'; end if;
  select * into t from public.transactions where id = p_id for update;
  if t.id is null or not public.is_party(t, uid) then raise exception 'Transaction not found'; end if;
  if t.step >= 6 or t.cx is not null then raise exception 'Transaction already closed'; end if;

  update public.transactions
     set cx = p_kind,
         log = log || jsonb_build_array(jsonb_build_array(
                 case p_kind when 'dispute' then 'Dispute raised (simulated)' else 'Cancelled' end,
                 to_char(now(), 'YYYY-MM-DD')))
   where id = t.id;

  perform set_config('agrireuse.tx', 'on', true);
  update public.listings set res = round(greatest(res - t.q, 0)::numeric, 3)
   where id = t.supply_id returning listings.mat into mat;

  perform public.notify(case when uid = t.supplier_id then t.receiver_id else t.supplier_id end,
                        p_kind || ': ' || mat);
end $$;

revoke execute on function public.start_transaction(text, text, double precision) from public, anon;
revoke execute on function public.advance_transaction(text, double precision) from public, anon;
revoke execute on function public.cancel_transaction(text, text) from public, anon;
grant execute on function public.start_transaction(text, text, double precision) to authenticated;
grant execute on function public.advance_transaction(text, double precision) to authenticated;
grant execute on function public.cancel_transaction(text, text) to authenticated;

-- ============================================================== realtime
alter publication supabase_realtime add table public.listings, public.transactions, public.notifications, public.verifications;
