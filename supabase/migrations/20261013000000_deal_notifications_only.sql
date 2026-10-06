-- Notifications are only for someone trying to make a deal with you:
--   a new exchange proposed to you, a new offer, or a counter-offer.
-- Step updates, cancellations, offer replies and new-match alerts are no longer sent
-- (deal steps still appear under "Waiting on you" and in Transactions).
-- Run after 20261012000000_request_keywords.sql.

-- Every database function sends through notify(); only deal attempts get through.
create or replace function public.notify(uid uuid, msg text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, txt, tab)
  select uid, msg, 'Transactions'
   where uid is not null
     and (msg like 'New exchange proposed:%' or msg like 'New offer:%' or msg like 'Counter-offer:%');
$$;
revoke execute on function public.notify(uuid, text) from public, anon, authenticated;

-- Remove existing notifications of the kinds no longer sent.
delete from public.notifications
 where not (txt like 'New exchange proposed:%' or txt like 'New offer:%' or txt like 'Counter-offer:%');
