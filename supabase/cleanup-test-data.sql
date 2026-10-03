-- Removes automated-test accounts (business names starting with "QA ") and everything they created,
-- and restores seeded listings those tests used. Paste into Supabase > SQL Editor and click Run.

create temp table qa_users as
  select id from public.profiles where business_name like 'QA %';

-- Seeded supply used by a test exchange: give back what the test reserved/consumed.
update public.listings l
   set done = greatest(l.done - x.done_q, 0), res = greatest(l.res - x.res_q, 0)
  from (
    select supply_id,
           sum(case when step = 6 then q else 0 end) as done_q,
           sum(case when step < 6 and cx is null then q else 0 end) as res_q
      from public.transactions
     where supplier_id in (select id from qa_users)
        or receiver_id in (select id from qa_users)
        or proposer_id in (select id from qa_users)
     group by supply_id
  ) x
 where l.id = x.supply_id and l.owner_id is null;

delete from public.transactions
 where supplier_id in (select id from qa_users)
    or receiver_id in (select id from qa_users)
    or proposer_id in (select id from qa_users);

delete from public.verifications where verified_by in (select id from qa_users);
delete from public.listings where owner_id in (select id from qa_users);
delete from auth.users where id in (select id from qa_users); -- profiles + notifications cascade

select count(*) as qa_accounts_left from public.profiles where business_name like 'QA %';
