-- Deal requests: a deal only starts once both sides agree.
--  * Either side sends a request (amount + price + message) on a pair of listings; the other side
--    approves, declines or counters (price and/or amount). Approving creates the exchange with
--    terms agreed and reserves the tonnes at that moment (first approved wins).
--  * Requests reuse the `offers` table. A request can be sent for any pair that's safe to trade:
--    use, dates and kind of material are for the two sides to agree, not hard limits.
--  * Buyers can request a supply straight from the Marketplace without posting a request: the app
--    creates a private request listing for them (never shown to others or matched).
-- Run after 20261013000000_deal_notifications_only.sql.

alter table public.listings add column if not exists private boolean not null default false;

-- Notifications: deal attempts only (new request or counter).
create or replace function public.notify(uid uuid, msg text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, txt, tab)
  select uid, msg, 'Transactions'
   where uid is not null
     and (msg like 'New deal request:%' or msg like 'Counter-offer:%' or msg like 'New exchange proposed:%' or msg like 'New offer:%');
$$;
revoke execute on function public.notify(uuid, text) from public, anon, authenticated;

-- Retire a private request listing once nothing open or agreed refers to it.
create or replace function public.retire_private_if_unused(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.listings where id = p_id and private)
     and not exists (select 1 from public.offers where demand_id = p_id and status = 'pending')
     and not exists (select 1 from public.transactions where demand_id = p_id)
  then
    perform set_config('agrireuse.tx', 'on', true);
    update public.listings set arch = true where id = p_id;
  end if;
end $$;
revoke execute on function public.retire_private_if_unused(text) from public, anon, authenticated;

-- Send a deal request.
create or replace function public.send_offer(p_supply text, p_demand text, p_price double precision, p_q double precision, p_message text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.listings;
  d public.listings;
  other uuid;
  o public.offers;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into s from public.listings where id = p_supply and type = 'Supply';
  select * into d from public.listings where id = p_demand and type = 'Demand';
  if s.id is null or d.id is null then raise exception 'Listing not found'; end if;
  if uid is distinct from s.owner_id and uid is distinct from d.owner_id then raise exception 'You can only send requests for your own listings'; end if;
  if s.owner_id = d.owner_id then raise exception 'You can''t trade with yourself'; end if;
  if s.arch or d.arch or s.deleted_at is not null or d.deleted_at is not null then raise exception 'That listing is no longer active'; end if;
  if public.in_fruit_fly_zone(s) then raise exception 'Not allowed: material in a fruit fly controlled area can''t leave the zone (MPI)'; end if;
  if p_price is null or p_price < 0 then raise exception 'Enter a price of 0 or more'; end if;
  if p_q is null or p_q <= 0 then raise exception 'Enter an amount more than 0'; end if;
  if p_q > s.qty - s.done - s.res + 1e-9 then raise exception 'Only % t is still available', round((s.qty - s.done - s.res)::numeric, 2); end if;
  if exists (select 1 from public.offers x where x.supply_id = s.id and x.demand_id = d.id and x.status = 'pending') then
    raise exception 'There’s already an open request between these listings';
  end if;

  other := case when uid = s.owner_id then d.owner_id else s.owner_id end;
  insert into public.offers (supply_id, demand_id, from_user, to_user, price, q, message)
  values (s.id, d.id, uid, other, p_price, p_q, nullif(trim(p_message), ''))
  returning * into o;
  perform public.notify(other, 'New deal request: $' || p_price || '/t for ' || p_q || ' t of ' || s.mat);
  return jsonb_build_object('status', 'pending', 'offer_id', o.id);
end $$;

-- Reply to a request: approve / decline / counter (recipient) or withdraw (sender).
drop function if exists public.respond_offer(text, text, double precision);
create or replace function public.respond_offer(p_offer text, p_action text, p_price double precision default null, p_q double precision default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  o public.offers;
  s public.listings;
  n public.offers;
  tx text;
  q double precision;
begin
  select * into o from public.offers where id = p_offer for update;
  if o.id is null or (uid is distinct from o.from_user and uid is distinct from o.to_user) then raise exception 'Request not found'; end if;
  if o.status <> 'pending' then raise exception 'This request is no longer open'; end if;
  select * into s from public.listings where id = o.supply_id;

  if p_action = 'withdraw' then
    if uid is distinct from o.from_user then raise exception 'Only the sender can withdraw a request'; end if;
    update public.offers set status = 'withdrawn', updated_at = now() where id = o.id;
    perform public.retire_private_if_unused(o.demand_id);
    return jsonb_build_object('status', 'withdrawn');
  end if;

  if uid is distinct from o.to_user then raise exception 'Only the recipient can reply to this request'; end if;

  if p_action = 'accept' then
    -- Approving is the "terms agreed" step: the exchange starts and the tonnes are reserved now.
    tx := public.offer_to_transaction(o);
    update public.offers set status = 'accepted', transaction_id = tx, updated_at = now() where id = o.id;
    return jsonb_build_object('status', 'accepted', 'transaction_id', tx);

  elsif p_action = 'decline' then
    update public.offers set status = 'declined', updated_at = now() where id = o.id;
    perform public.retire_private_if_unused(o.demand_id);
    return jsonb_build_object('status', 'declined');

  elsif p_action = 'counter' then
    q := coalesce(p_q, o.q);
    if p_price is null or p_price < 0 then raise exception 'Enter a price of 0 or more'; end if;
    if q <= 0 then raise exception 'Enter an amount more than 0'; end if;
    if q > s.qty - s.done - s.res + 1e-9 then raise exception 'Only % t is still available', round((s.qty - s.done - s.res)::numeric, 2); end if;
    update public.offers set status = 'countered', note = 'Countered: $' || p_price || '/t for ' || q || ' t', updated_at = now() where id = o.id;
    -- A private request listing follows the amount being negotiated.
    perform set_config('agrireuse.tx', 'on', true);
    update public.listings set max_qty = greatest(max_qty, q), min_qty = least(min_qty, q) where id = o.demand_id and private;
    insert into public.offers (supply_id, demand_id, from_user, to_user, price, q, parent_id)
    values (o.supply_id, o.demand_id, uid, o.from_user, p_price, q, o.id) returning * into n;
    perform public.notify(o.from_user, 'Counter-offer: $' || p_price || '/t for ' || q || ' t of ' || s.mat);
    return jsonb_build_object('status', 'countered', 'offer_id', n.id);
  end if;
  raise exception 'Unknown action';
end $$;

revoke execute on function public.respond_offer(text, text, double precision, double precision) from public, anon;
grant execute on function public.respond_offer(text, text, double precision, double precision) to authenticated;

-- Approving a request creates the exchange with terms agreed and reserves the tonnes.
create or replace function public.offer_to_transaction(o public.offers) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.listings;
  d public.listings;
  tx text;
begin
  select * into s from public.listings where id = o.supply_id for update;
  select * into d from public.listings where id = o.demand_id;
  if s.arch or d.arch or s.deleted_at is not null or d.deleted_at is not null then raise exception 'One of the listings is no longer active'; end if;
  if public.in_fruit_fly_zone(s) then raise exception 'Not allowed: material in a fruit fly controlled area can''t leave the zone (MPI)'; end if;
  if public.needs_verification(s, d) then raise exception 'Complete the (simulated) verification for this pair first'; end if;
  if o.q > s.qty - s.done - s.res + 1e-9 then
    raise exception 'Only % t is still available: another request may have been approved first', round((s.qty - s.done - s.res)::numeric, 2);
  end if;

  perform set_config('agrireuse.tx', 'on', true);
  update public.listings set res = round((res + o.q)::numeric, 3) where id = s.id;
  insert into public.transactions (supply_id, demand_id, supplier_id, receiver_id, proposer_id, q, price, step, log)
  values (s.id, d.id, s.owner_id, d.owner_id, coalesce(o.from_user, o.to_user), o.q, o.price, 0,
          jsonb_build_array(
            jsonb_build_array('Request sent: $' || o.price || '/t for ' || o.q || ' t', to_char(o.created_at, 'YYYY-MM-DD')),
            jsonb_build_array('Approved: terms agreed by both parties', to_char(now(), 'YYYY-MM-DD'))))
  returning id into tx;
  return tx;
end $$;
revoke execute on function public.offer_to_transaction(public.offers) from public, anon, authenticated;
