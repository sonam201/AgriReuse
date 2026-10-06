-- Empties the marketplace for EVERYONE: all listings, exchanges, offers, verifications and
-- notifications (real and fictional). Accounts, profiles and settings are kept.
-- This cannot be undone. Paste into Supabase > SQL Editor and click Run (all or nothing).

begin;

delete from public.offers;
delete from public.transactions;
delete from public.verifications;
delete from public.notifications;
delete from public.listings;
update public.app_settings set value = jsonb_set(value, '{active}', 'false') where key = 'demo_fruit_fly_zone';

select
  (select count(*) from public.listings) as listings_left,
  (select count(*) from public.transactions) as exchanges_left,
  (select count(*) from public.offers) as offers_left,
  (select count(*) from public.profiles) as accounts_kept;

commit;
