-- One account can supply AND receive.
--  * profiles.role stays as the account's starting role (chosen at sign-up).
--  * can_supply / can_receive say what the account may list. A role can be added later
--    from the Profile page, but never removed (archive listings to stop instead).
--  * An account can't trade with itself.

alter table public.profiles
  add column if not exists can_supply boolean not null default false,
  add column if not exists can_receive boolean not null default false;

update public.profiles
   set can_supply = can_supply or role = 'Supplier',
       can_receive = can_receive or role = 'Receiver';

alter table public.profiles drop constraint if exists profiles_has_a_role;
alter table public.profiles add constraint profiles_has_a_role check (can_supply or can_receive);

-- New accounts start with the role they picked.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := coalesce(new.raw_user_meta_data ->> 'role', 'Supplier');
begin
  insert into public.profiles (id, business_name, role, location, can_supply, can_receive)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''), 'New business'),
    r,
    nullif(new.raw_user_meta_data ->> 'location', ''),
    r = 'Supplier',
    r = 'Receiver'
  );
  return new;
end $$;

-- Starting role is fixed; roles can only be added, never removed.
create or replace function public.profiles_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.role := old.role;
  new.created_at := old.created_at;
  new.can_supply := old.can_supply or new.can_supply;
  new.can_receive := old.can_receive or new.can_receive;
  if length(trim(new.business_name)) = 0 then raise exception 'Business name is required'; end if;
  new.business_name := trim(new.business_name);
  return new;
end $$;

-- Listing type must be one the account has turned on.
create or replace function public.listings_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then return new; end if; -- seed scripts / service role
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'No profile for this user'; end if;
  if new.type = 'Supply' and not p.can_supply then
    raise exception 'Turn on selling in your Profile before listing supply';
  end if;
  if new.type = 'Demand' and not p.can_receive then
    raise exception 'Turn on buying in your Profile before posting a request';
  end if;
  new.owner_id := auth.uid();
  new.biz := p.business_name;
  new.done := 0;
  new.res := 0;
  new.move_r := false;
  return new;
end $$;

-- Same checks as before, plus: no exchanges between two listings of the same account.
create or replace function public.start_transaction(p_supply text, p_demand text, p_q double precision) returns text
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
  if s.owner_id = d.owner_id then raise exception 'You can''t trade with yourself'; end if;
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
