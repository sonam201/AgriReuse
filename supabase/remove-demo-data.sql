-- Removes all fictional (seeded) businesses and everything that involves them, so the app runs
-- on real accounts only. Your own accounts, listings, profiles and settings are kept.
-- To bring the demo data back later, run supabase/restore-demo-data.sql.
-- Paste into Supabase > SQL Editor and click Run. Runs as one transaction: all or nothing.

begin;

-- Exchanges where either side is a fictional listing.
create temp table demo_tx on commit drop as
  select t.* from public.transactions t
    join public.listings s on s.id = t.supply_id
    join public.listings d on d.id = t.demand_id
   where s.owner_id is null or d.owner_id is null;

-- 1. Give back tonnes those exchanges reserved or used up on your own supply listings.
update public.listings l
   set done = round(greatest(l.done - x.done_q, 0)::numeric, 3),
       res  = round(greatest(l.res - x.res_q, 0)::numeric, 3)
  from (
    select supply_id,
           sum(case when step = 6 then q else 0 end) as done_q,
           sum(case when step < 6 and cx is null then q else 0 end) as res_q
      from demo_tx group by supply_id
  ) x
 where l.id = x.supply_id and l.owner_id is not null;

-- 2. Offers and exchanges involving fictional listings.
delete from public.offers o
 using public.listings l
 where l.owner_id is null and l.id in (o.supply_id, o.demand_id);
delete from public.transactions where id in (select id from demo_tx);

-- 3. The fictional listings themselves (their verifications are removed with them).
delete from public.listings where owner_id is null;

-- What's left: should show 0 fictional listings.
select
  (select count(*) from public.listings where owner_id is null) as fictional_listings_left,
  (select count(*) from public.listings) as real_listings,
  (select count(*) from public.transactions) as exchanges,
  (select count(*) from public.profiles) as accounts;

commit;
