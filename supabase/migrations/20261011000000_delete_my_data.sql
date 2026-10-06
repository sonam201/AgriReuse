-- "Your data": each user can delete their own history, part by part.
--  * Exchanges and offers are shared, so deleting hides them for you only; the other business
--    keeps its copy. Once every real party has deleted a record, it is removed for good.
--  * Anything still open is closed first: exchanges are cancelled (tonnes released), pending
--    offers are withdrawn or declined, and the other side is notified.
--  * Your listings are removed. A listing that is part of someone else's exchange history is
--    retired instead (hidden everywhere, kept so their history still makes sense).
-- Run after 20261010000000_offers_and_alerts.sql.

alter table public.transactions add column if not exists hidden_for uuid[] not null default '{}';
alter table public.offers add column if not exists hidden_for uuid[] not null default '{}';
alter table public.listings add column if not exists deleted_at timestamptz;

-- Hidden records drop out of the deleting user's view only.
drop policy if exists "transactions visible to parties or when completed" on public.transactions;
create policy "transactions visible to parties or when completed" on public.transactions
  for select to authenticated
  using ((step = 6 or auth.uid() in (supplier_id, receiver_id, proposer_id)) and not (auth.uid() = any(hidden_for)));

drop policy if exists "offers visible to both sides" on public.offers;
create policy "offers visible to both sides" on public.offers
  for select to authenticated
  using ((auth.uid() = from_user or auth.uid() = to_user) and not (auth.uid() = any(hidden_for)));

-- Permanently removes shared records every real party has deleted, then retired listings
-- that nothing refers to any more.
create or replace function public.purge_deleted() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.offers o
   where (o.from_user is null or o.from_user = any(o.hidden_for))
     and (o.to_user is null or o.to_user = any(o.hidden_for));
  delete from public.transactions t
   where (t.supplier_id is null or t.supplier_id = any(t.hidden_for))
     and (t.receiver_id is null or t.receiver_id = any(t.hidden_for))
     and (t.proposer_id is null or t.proposer_id = any(t.hidden_for));
  delete from public.listings l
   where l.deleted_at is not null
     and not exists (select 1 from public.transactions t where t.supply_id = l.id or t.demand_id = l.id);
end $$;
revoke execute on function public.purge_deleted() from public, anon, authenticated;

-- Closes anything still open for the caller (optionally only on one listing).
create or replace function public.close_open_for_me(uid uuid, p_listing text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select o.id, o.from_user from public.offers o
     where o.status = 'pending' and uid in (o.from_user, o.to_user)
       and (p_listing is null or p_listing in (o.supply_id, o.demand_id))
  loop
    perform public.respond_offer(r.id, case when r.from_user = uid then 'withdraw' else 'decline' end);
  end loop;
  for r in
    select t.id from public.transactions t
     where t.step < 6 and t.cx is null and public.is_party(t, uid)
       and (p_listing is null or p_listing in (t.supply_id, t.demand_id))
  loop
    perform public.cancel_transaction(r.id, 'cancelled');
  end loop;
end $$;
revoke execute on function public.close_open_for_me(uuid, text) from public, anon, authenticated;

-- Removes (or retires) one of the caller's listings.
create or replace function public.delete_my_listing(p_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  l public.listings;
begin
  select * into l from public.listings where id = p_id;
  if l.id is null or l.owner_id is distinct from uid then raise exception 'Listing not found'; end if;
  perform public.close_open_for_me(uid, l.id);
  delete from public.offers o where l.id in (o.supply_id, o.demand_id) and o.status <> 'accepted';
  if exists (select 1 from public.transactions t where t.supply_id = l.id or t.demand_id = l.id) then
    perform set_config('agrireuse.tx', 'on', true);
    update public.listings set deleted_at = now(), arch = true where id = l.id;
    perform public.purge_deleted();
    return case when exists (select 1 from public.listings where id = l.id) then 'retired' else 'deleted' end;
  end if;
  delete from public.listings where id = l.id;
  return 'deleted';
end $$;

-- Deletes one part of the caller's history: 'listings', 'exchanges', 'offers' or 'notifications'.
create or replace function public.delete_my_data(p_part text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n integer := 0;
  r record;
begin
  if uid is null then raise exception 'Sign in required'; end if;

  if p_part = 'notifications' then
    delete from public.notifications where user_id = uid;
    get diagnostics n = row_count;

  elsif p_part = 'offers' then
    perform public.close_open_for_me(uid);
    update public.offers set hidden_for = array_append(hidden_for, uid)
     where uid in (from_user, to_user) and not (uid = any(hidden_for));
    get diagnostics n = row_count;
    perform public.purge_deleted();

  elsif p_part = 'exchanges' then
    perform public.close_open_for_me(uid);
    update public.transactions t set hidden_for = array_append(t.hidden_for, uid)
     where public.is_party(t, uid) and not (uid = any(t.hidden_for));
    get diagnostics n = row_count;
    perform public.purge_deleted();

  elsif p_part = 'listings' then
    for r in select id from public.listings where owner_id = uid and deleted_at is null loop
      perform public.delete_my_listing(r.id);
      n := n + 1;
    end loop;

  else
    raise exception 'Unknown part: %', p_part;
  end if;
  return n;
end $$;

revoke execute on function public.delete_my_listing(text) from public, anon;
revoke execute on function public.delete_my_data(text) from public, anon;
grant execute on function public.delete_my_listing(text) to authenticated;
grant execute on function public.delete_my_data(text) to authenticated;
