-- After matching:
--  * Offers: either side can send an offer on a near-miss pair (price, distance or minimum
--    quantity slightly out of range). The other side accepts, declines or counters. Fictional
--    seeded businesses respond automatically. Accepting creates the exchange at the agreed price.
--  * New-match alerts: when a listing is published, owners of matching listings are notified.
-- Run after 20261009000000_match_categories.sql.

-- ============================================================== towns (server-side distance)
create table if not exists public.towns (name text primary key, lat double precision not null, lon double precision not null);
alter table public.towns enable row level security;
drop policy if exists "towns readable" on public.towns;
create policy "towns readable" on public.towns for select to authenticated using (true);
insert into public.towns (name, lat, lon) values
  ('Pukekohe', -37.2, 174.95), ('Hastings', -39.64, 176.84), ('Whangarei', -35.73, 174.32), ('Rotorua', -38.14, 176.25),
  ('Nelson', -41.27, 173.28), ('Hamilton', -37.78, 175.28), ('Auckland', -36.85, 174.76), ('Tauranga', -37.69, 176.17),
  ('Cambridge', -37.89, 175.47), ('Palmerston North', -40.36, 175.61)
on conflict (name) do nothing;

-- Straight-line distance × 1.3 road multiplier (same as the app's default).
create or replace function public.town_km(a text, b text) returns double precision
language sql stable set search_path = '' as $$
  select 12742 * asin(sqrt(
           power(sin(radians(tb.lat - ta.lat) / 2), 2)
         + cos(radians(ta.lat)) * cos(radians(tb.lat)) * power(sin(radians(tb.lon - ta.lon) / 2), 2))) * 1.3
    from public.towns ta, public.towns tb where ta.name = a and tb.name = b
$$;

-- ============================================================== offers
create table if not exists public.offers (
  id text primary key default gen_random_uuid()::text,
  supply_id text not null references public.listings on delete cascade,
  demand_id text not null references public.listings on delete cascade,
  from_user uuid references public.profiles on delete cascade, -- null = fictional business
  to_user uuid references public.profiles on delete cascade,   -- null = fictional business
  price double precision not null check (price >= 0),
  q double precision not null check (q > 0),
  message text check (length(message) <= 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'countered', 'withdrawn')),
  note text, -- reason shown to the sender (e.g. why a fictional business declined)
  parent_id text references public.offers on delete set null,
  transaction_id text references public.transactions on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offers_from_idx on public.offers (from_user);
create index if not exists offers_to_idx on public.offers (to_user);

alter table public.offers enable row level security;
drop policy if exists "offers visible to both sides" on public.offers;
create policy "offers visible to both sides" on public.offers
  for select to authenticated using (auth.uid() = from_user or auth.uid() = to_user);
-- No direct writes: send_offer / respond_offer below enforce the rules.

alter publication supabase_realtime add table public.offers;

-- Turns an accepted offer into an exchange (terms already agreed), reserving the quantity.
create or replace function public.offer_to_transaction(o public.offers) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.listings;
  d public.listings;
  tx text;
begin
  select * into s from public.listings where id = o.supply_id for update;
  select * into d from public.listings where id = o.demand_id;
  if s.arch or d.arch then raise exception 'One of the listings has been archived'; end if;
  if public.in_fruit_fly_zone(s) then raise exception 'Not allowed: material in a fruit fly controlled area can''t leave the zone (MPI)'; end if;
  if public.needs_verification(s, d) then raise exception 'Complete the (simulated) verification for this match first'; end if;
  if o.q > s.qty - s.done - s.res + 1e-9 then raise exception 'Not enough quantity left for this offer'; end if;

  perform set_config('agrireuse.tx', 'on', true);
  update public.listings set res = round((res + o.q)::numeric, 3) where id = s.id;
  insert into public.transactions (supply_id, demand_id, supplier_id, receiver_id, proposer_id, q, price, step, log)
  values (s.id, d.id, s.owner_id, d.owner_id, coalesce(o.from_user, o.to_user), o.q, o.price, 0,
          jsonb_build_array(
            jsonb_build_array('Offer sent: $' || o.price || '/t for ' || o.q || ' t', to_char(o.created_at, 'YYYY-MM-DD')),
            jsonb_build_array('Offer accepted → terms agreed by both parties', to_char(now(), 'YYYY-MM-DD'))))
  returning id into tx;
  return tx;
end $$;
revoke execute on function public.offer_to_transaction(public.offers) from public, anon, authenticated;

-- Send an offer on a near-miss pair. Returns the outcome (fictional businesses reply at once).
create or replace function public.send_offer(p_supply text, p_demand text, p_price double precision, p_q double precision, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.listings;
  d public.listings;
  me_supplier boolean;
  other uuid;
  o public.offers;
  dist double precision;
  limit_price double precision;
  price_ok boolean;
  tx text;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into s from public.listings where id = p_supply and type = 'Supply';
  select * into d from public.listings where id = p_demand and type = 'Demand';
  if s.id is null or d.id is null then raise exception 'Listing not found'; end if;
  if uid is distinct from s.owner_id and uid is distinct from d.owner_id then raise exception 'You can only make offers on your own listings'; end if;
  if s.owner_id = d.owner_id then raise exception 'You can''t trade with yourself'; end if;
  if s.arch or d.arch then raise exception 'Listing is archived'; end if;
  if public.in_fruit_fly_zone(s) then raise exception 'Not allowed: material in a fruit fly controlled area can''t leave the zone (MPI)'; end if;
  -- Offers can stretch price, distance and minimum quantity, not what the material is or when.
  if not (d.use1 = any(s.uses)) then raise exception 'The seller hasn''t listed this use'; end if;
  if d.accepts is not null and cardinality(d.accepts) > 0 and s.category is not null and not (s.category = any(d.accepts)) then
    raise exception 'The buyer doesn''t take this kind of material';
  end if;
  if s.from_date > d.to_date or s.to_date < d.from_date then raise exception 'Availability dates don''t overlap'; end if;
  if p_price is null or p_price < 0 then raise exception 'Enter a price of 0 or more'; end if;
  if p_q is null or p_q <= 0 or p_q > s.qty - s.done - s.res + 1e-9 or p_q > d.max_qty + 1e-9 then raise exception 'Quantity must be within what''s available and requested'; end if;
  if exists (select 1 from public.offers x where x.supply_id = s.id and x.demand_id = d.id and x.status = 'pending') then
    raise exception 'There''s already an open offer between these listings';
  end if;

  me_supplier := uid = s.owner_id;
  other := case when me_supplier then d.owner_id else s.owner_id end;
  insert into public.offers (supply_id, demand_id, from_user, to_user, price, q, message)
  values (s.id, d.id, uid, other, p_price, p_q, nullif(trim(p_message), ''))
  returning * into o;

  if other is not null then
    perform public.notify(other, 'New offer: $' || p_price || '/t for ' || p_q || ' t of ' || s.mat);
    return jsonb_build_object('status', 'pending', 'offer_id', o.id);
  end if;

  -- Fictional business replies: accepts within 25% of its price limit, 1.5× its distance and
  -- half its minimum quantity; counters on price alone; otherwise declines with the reason.
  dist := public.town_km(s.loc, d.loc);
  limit_price := case when me_supplier then d.max_price else s.price end;
  price_ok := case when me_supplier then p_price <= d.max_price * 1.25 else p_price >= s.price * 0.75 end;
  if dist > d.max_km * 1.5 then
    update public.offers set status = 'declined', note = 'Too far for us (' || round(dist::numeric) || ' km)', updated_at = now() where id = o.id;
    return jsonb_build_object('status', 'declined', 'offer_id', o.id, 'note', 'Too far for them (' || round(dist::numeric) || ' km)');
  elsif p_q < d.min_qty * 0.5 then
    update public.offers set status = 'declined', note = 'Too small a load for us', updated_at = now() where id = o.id;
    return jsonb_build_object('status', 'declined', 'offer_id', o.id, 'note', 'Too small a load for them');
  elsif not price_ok then
    update public.offers set status = 'countered', note = 'Countered at $' || limit_price || '/t', updated_at = now() where id = o.id;
    insert into public.offers (supply_id, demand_id, from_user, to_user, price, q, message, parent_id)
    values (s.id, d.id, null, uid, limit_price, p_q, 'Best we can do is $' || limit_price || '/t.', o.id);
    perform public.notify(uid, 'Counter-offer: $' || limit_price || '/t for ' || s.mat);
    return jsonb_build_object('status', 'countered', 'offer_id', o.id, 'note', 'They countered at $' || limit_price || '/t');
  end if;
  tx := public.offer_to_transaction(o);
  update public.offers set status = 'accepted', transaction_id = tx, updated_at = now() where id = o.id;
  return jsonb_build_object('status', 'accepted', 'offer_id', o.id, 'transaction_id', tx);
end $$;

-- Reply to an offer: accept / decline / counter (recipient) or withdraw (sender).
create or replace function public.respond_offer(p_offer text, p_action text, p_price double precision default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  o public.offers;
  mat text;
  tx text;
  n public.offers;
begin
  select * into o from public.offers where id = p_offer for update;
  if o.id is null or (uid is distinct from o.from_user and uid is distinct from o.to_user) then raise exception 'Offer not found'; end if;
  if o.status <> 'pending' then raise exception 'This offer is no longer open'; end if;
  select l.mat into mat from public.listings l where l.id = o.supply_id;

  if p_action = 'withdraw' then
    if uid is distinct from o.from_user then raise exception 'Only the sender can withdraw an offer'; end if;
    update public.offers set status = 'withdrawn', updated_at = now() where id = o.id;
    perform public.notify(o.to_user, 'Offer withdrawn: ' || mat);
    return jsonb_build_object('status', 'withdrawn');
  end if;

  if uid is distinct from o.to_user then raise exception 'Only the recipient can reply to this offer'; end if;
  if p_action = 'accept' then
    tx := public.offer_to_transaction(o);
    update public.offers set status = 'accepted', transaction_id = tx, updated_at = now() where id = o.id;
    perform public.notify(o.from_user, 'Offer accepted: ' || mat || ' (exchange started)');
    return jsonb_build_object('status', 'accepted', 'transaction_id', tx);
  elsif p_action = 'decline' then
    update public.offers set status = 'declined', updated_at = now() where id = o.id;
    perform public.notify(o.from_user, 'Offer declined: ' || mat);
    return jsonb_build_object('status', 'declined');
  elsif p_action = 'counter' then
    if p_price is null or p_price < 0 then raise exception 'Enter a counter price of 0 or more'; end if;
    update public.offers set status = 'countered', note = 'Countered at $' || p_price || '/t', updated_at = now() where id = o.id;
    insert into public.offers (supply_id, demand_id, from_user, to_user, price, q, parent_id)
    values (o.supply_id, o.demand_id, uid, o.from_user, p_price, o.q, o.id) returning * into n;
    perform public.notify(o.from_user, 'Counter-offer: $' || p_price || '/t for ' || mat);
    -- Countering a fictional business's offer: it accepts your counter if within 25% of its own.
    if o.from_user is null then
      if abs(p_price - o.price) <= o.price * 0.25 + 1e-9 then
        tx := public.offer_to_transaction(n);
        update public.offers set status = 'accepted', transaction_id = tx, updated_at = now() where id = n.id;
        return jsonb_build_object('status', 'accepted', 'transaction_id', tx);
      end if;
      update public.offers set status = 'declined', note = 'That''s too far from our price', updated_at = now() where id = n.id;
      return jsonb_build_object('status', 'declined', 'note', 'They declined: too far from their price');
    end if;
    return jsonb_build_object('status', 'countered', 'offer_id', n.id);
  end if;
  raise exception 'Unknown action';
end $$;

revoke execute on function public.send_offer(text, text, double precision, double precision, text) from public, anon;
revoke execute on function public.respond_offer(text, text, double precision) from public, anon;
grant execute on function public.send_offer(text, text, double precision, double precision, text) to authenticated;
grant execute on function public.respond_offer(text, text, double precision) to authenticated;

-- ============================================================== new-match alerts
-- Called by the app right after publishing: notifies owners of the listings the new one
-- matches. Only listings of the opposite type that the caller doesn't own can be notified.
create or replace function public.notify_matches(p_listing text, p_targets text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  l public.listings;
  n integer := 0;
  t record;
begin
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from uid then raise exception 'Listing not found'; end if;
  for t in
    select distinct x.owner_id from public.listings x
     where x.id = any(p_targets[1:50]) and x.type <> l.type and not x.arch
       and x.owner_id is not null and x.owner_id <> uid
  loop
    perform public.notify(t.owner_id, 'New match: ' || l.mat || ' (' || l.loc || ')');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.notify_matches(text, text[]) from public, anon;
grant execute on function public.notify_matches(text, text[]) to authenticated;
