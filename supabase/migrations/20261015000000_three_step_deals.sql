-- Simpler deals: after a request is approved (terms agreed, step 0) there are three steps:
--   step 2 Pickup arranged   (seller: date/time + optional note)
--   step 4 Received          (buyer: tonnes actually received, can be less than agreed)
--   step 6 Completed         (seller; payment is simulated)
-- Step numbers stay on the old 0..6 scale (completed = 6) so everything that checks "completed"
-- or "still open" keeps working; the in-between odd numbers are no longer used.
-- Run after 20261014000000_deal_requests.sql.

alter table public.transactions
  add column if not exists pickup_at timestamptz,
  add column if not exists pickup_note text check (length(pickup_note) <= 200),
  add column if not exists received_q double precision check (received_q > 0);

-- Deals in progress under the old 7 steps move to the nearest new step.
update public.transactions set step = step - 1 where step in (1, 3, 5) and cx is null;

-- Who does the next step: 0 = whoever didn't send the request; 2 and 6 = seller; 4 = buyer.
create or replace function public.step_actor(t public.transactions, next_step int) returns uuid
language sql immutable as $$
  select case
    when next_step = 0 then case when t.proposer_id = t.supplier_id then t.receiver_id else t.supplier_id end
    when next_step = 4 then t.receiver_id
    else t.supplier_id
  end
$$;

drop function if exists public.advance_transaction(text, double precision, double precision, double precision);

create or replace function public.advance_transaction(
  p_id text,
  p_co2 double precision default null,
  p_supplier_benefit double precision default null,
  p_receiver_benefit double precision default null,
  p_pickup_at timestamptz default null,
  p_note text default null,
  p_received_q double precision default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  s public.listings;
  d public.listings;
  actor uuid;
  nxt int;
  label text;
begin
  select * into t from public.transactions where id = p_id for update;
  if t.id is null or not public.is_party(t, uid) then raise exception 'Deal not found'; end if;
  if t.step >= 6 or t.cx is not null then raise exception 'This deal is already closed'; end if;
  nxt := case when t.step < 0 then 0 else t.step + 2 end;
  actor := public.step_actor(t, nxt);
  label := case nxt when 0 then 'Terms agreed by both parties' when 2 then 'Pickup arranged' when 4 then 'Received' else 'Completed' end;
  -- A null actor is a fictional seeded business: the real party simulates their step.
  if actor is not null and actor <> uid then raise exception 'Waiting for the other business to: %', label; end if;

  select * into s from public.listings where id = t.supply_id for update;
  select * into d from public.listings where id = t.demand_id;
  if public.in_fruit_fly_zone(s) then raise exception 'Not allowed: material in a fruit fly controlled area can''t leave the zone (MPI)'; end if;
  if public.needs_verification(s, d) then raise exception 'Complete the (simulated) verification first'; end if;

  if nxt = 2 then
    if p_pickup_at is null then raise exception 'Choose a pickup date and time'; end if;
    update public.transactions
       set step = 2, pickup_at = p_pickup_at, pickup_note = nullif(trim(p_note), ''),
           log = log || jsonb_build_array(jsonb_build_array(
             'Pickup arranged for ' || to_char(p_pickup_at at time zone 'Pacific/Auckland', 'Dy DD Mon HH24:MI')
               || coalesce(' · ' || nullif(trim(p_note), ''), ''), to_char(now(), 'YYYY-MM-DD')))
     where id = t.id;

  elsif nxt = 4 then
    if p_received_q is null or p_received_q <= 0 then raise exception 'Enter the tonnes received'; end if;
    if p_received_q > t.q + 1e-9 then raise exception 'Received can''t be more than the % t agreed', t.q; end if;
    update public.transactions
       set step = 4, received_q = p_received_q,
           log = log || jsonb_build_array(jsonb_build_array('Received ' || p_received_q || ' t of ' || t.q || ' t agreed', to_char(now(), 'YYYY-MM-DD')))
     where id = t.id;

  elsif nxt = 6 then
    -- Close on what was actually received; anything not delivered goes back on the listing.
    perform set_config('agrireuse.tx', 'on', true);
    update public.listings
       set res = round(greatest(res - t.q, 0)::numeric, 3), done = round((done + coalesce(t.received_q, t.q))::numeric, 3)
     where id = s.id;
    update public.transactions
       set step = 6, q = coalesce(received_q, q), co2 = p_co2, supplier_benefit = p_supplier_benefit, receiver_benefit = p_receiver_benefit,
           log = log || jsonb_build_array(jsonb_build_array('Completed (payment simulated)', to_char(now(), 'YYYY-MM-DD')))
     where id = t.id;

  else -- 0: terms agreed on an older-style proposal
    update public.transactions
       set step = 0, log = log || jsonb_build_array(jsonb_build_array(label, to_char(now(), 'YYYY-MM-DD')))
     where id = t.id;
  end if;
end $$;

revoke execute on function public.advance_transaction(text, double precision, double precision, double precision, timestamptz, text, double precision) from public, anon;
grant execute on function public.advance_transaction(text, double precision, double precision, double precision, timestamptz, text, double precision) to authenticated;
