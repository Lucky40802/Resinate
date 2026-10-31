-- Resinate: accounts, roles, orders, settings and photos, for the shop's Supabase project.
-- Paste this whole file into the project's SQL Editor and run it. It is safe to run again after an update.
--
-- resinate_profiles  one row per account (made automatically when someone signs up): name, contact, photo and role.
--                    role is 'customer' or 'maker'. Makers open the dashboard. People can edit their own name,
--                    contact and photo, but never their role: change roles here in the console only (see the end).
-- resinate_staff     emails to make makers as soon as they sign up (console only; optional).
-- resinate_settings  'prices' and 'payment'. Everyone can read them (the shop shows them); only makers change them.
-- resinate_messages  messages sent from the site's "Message us" form; only makers read them
-- resinate_orders    every order. Customers place one only through resinate_place_order(), which prices it on the
--                    server; a signed-in customer can read their own orders; makers read and change all of them.
-- resinate_photos    the "Our work" gallery. Files live in the public storage bucket 'resinate', with profile
--                    photos under avatars/<account id>/.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ── accounts and roles ───────────────────────────────────────────
create table if not exists public.resinate_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '' check (char_length(display_name) <= 80),
  contact text not null default '' check (char_length(contact) <= 200),     -- phone, Instagram or email for orders
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  role text not null default 'customer' check (role in ('customer', 'maker')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.resinate_profiles enable row level security;
revoke all on public.resinate_profiles from anon, authenticated;
grant select on public.resinate_profiles to authenticated;
grant update (display_name, contact, avatar_path, updated_at) on public.resinate_profiles to authenticated;  -- never role or email
drop policy if exists "read your own profile" on public.resinate_profiles;
create policy "read your own profile" on public.resinate_profiles for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists "edit your own profile" on public.resinate_profiles;
create policy "edit your own profile" on public.resinate_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- emails to make makers the moment they sign up. Console only: the website can't read or change it.
create table if not exists public.resinate_staff (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'staff',
  added_at timestamptz not null default now()
);
alter table public.resinate_staff enable row level security;
revoke all on public.resinate_staff from anon, authenticated;
drop policy if exists "see yourself" on public.resinate_staff;
drop policy if exists "editors manage the team" on public.resinate_staff;

-- every new account gets a profile; an email on resinate_staff starts as a maker
create or replace function private.resinate_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.resinate_profiles (id, email, role)
  values (new.id, lower(coalesce(new.email, '')),
          case when exists (select 1 from public.resinate_staff s where s.email = lower(new.email)) then 'maker' else 'customer' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists resinate_on_auth_user_created on auth.users;
create trigger resinate_on_auth_user_created after insert on auth.users
  for each row execute function private.resinate_new_user();

create or replace function private.resinate_email_changed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.resinate_profiles set email = lower(coalesce(new.email, '')) where id = new.id;
  return new;
end $$;
drop trigger if exists resinate_on_auth_email_changed on auth.users;
create trigger resinate_on_auth_email_changed after update of email on auth.users
  for each row execute function private.resinate_email_changed();

-- accounts made before this file ran get a profile too
insert into public.resinate_profiles (id, email, role)
select u.id, lower(coalesce(u.email, '')),
       case when exists (select 1 from public.resinate_staff s where s.email = lower(u.email)) then 'maker' else 'customer' end
from auth.users u
on conflict (id) do nothing;
update public.resinate_profiles p set role = 'maker'
where p.role = 'customer' and exists (select 1 from public.resinate_staff s where s.email = p.email);

-- the signed-in account's role: 'maker', 'customer', or null when signed out
create or replace function private.resinate_role() returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.resinate_profiles p where p.id = auth.uid()
$$;
create or replace function public.resinate_my_role() returns text language sql stable security definer set search_path = '' as $$
  select private.resinate_role()
$$;
revoke all on function public.resinate_my_role() from public, anon;
grant execute on function public.resinate_my_role() to authenticated;

-- delete your own account (orders you placed stay with the shop, unlinked from you).
-- The page removes your profile photo through the Storage API first.
create or replace function public.resinate_delete_me() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.resinate_delete_me() from public, anon;
grant execute on function public.resinate_delete_me() to authenticated;

-- ── settings ─────────────────────────────────────────────────────
create table if not exists public.resinate_settings (
  id text primary key check (id in ('prices', 'payment')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 20000),
  updated_at timestamptz not null default now()
);
alter table public.resinate_settings enable row level security;
revoke all on public.resinate_settings from anon, authenticated;
grant select on public.resinate_settings to anon, authenticated;
grant insert, update, delete on public.resinate_settings to authenticated;
drop policy if exists "anyone reads" on public.resinate_settings;
create policy "anyone reads" on public.resinate_settings for select to anon, authenticated using (true);
drop policy if exists "editors write" on public.resinate_settings;
drop policy if exists "makers add" on public.resinate_settings;
create policy "makers add" on public.resinate_settings for insert to authenticated
  with check ((select private.resinate_role()) = 'maker');
drop policy if exists "makers change" on public.resinate_settings;
create policy "makers change" on public.resinate_settings for update to authenticated
  using ((select private.resinate_role()) = 'maker') with check ((select private.resinate_role()) = 'maker');
drop policy if exists "makers remove" on public.resinate_settings;
create policy "makers remove" on public.resinate_settings for delete to authenticated
  using ((select private.resinate_role()) = 'maker');

-- prices in cents: the defaults, overridden by whatever makers saved
create or replace function private.resinate_prices() returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select coalesce((select data from public.resinate_settings where id = 'prices'), '{}'::jsonb) as d),
  def as (select '{"base":{"S":599,"M":999,"L":1399,"XL":1999},"print":{"S":199,"M":199,"L":299,"XL":299},
                   "theme":{"S":99,"M":99,"L":199,"XL":199},"dye":99,"sparkleLo":100,"sparkleHi":149,"sparkleXL":null,"led":{"L":449,"XL":399},
                   "customMin":200,"bundleOff":0}'::jsonb as d)
  select def.d || (s.d - 'base' - 'print' - 'theme' - 'led') || jsonb_build_object(
    'base',  (def.d -> 'base')  || coalesce(s.d -> 'base',  '{}'::jsonb),
    'print', (def.d -> 'print') || coalesce(s.d -> 'print', '{}'::jsonb),
    'theme', (def.d -> 'theme') || coalesce(s.d -> 'theme', '{}'::jsonb),
    'led',   (def.d -> 'led')   || coalesce(s.d -> 'led',   '{}'::jsonb))
  from s, def
$$;

-- what a list of pieces costs: the same rules as the shop page
-- the themed designs customers can pick (names and colours); makers change them on the dashboard
create or replace function private.resinate_designs() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select data -> 'list' from public.resinate_settings where id = 'designs' and jsonb_typeof(data -> 'list') = 'array'),
    '[{"name": "Ocean wave", "palette": ["Ocean teal", "Sky blue", "Pearl white"]}, {"name": "Forest", "palette": ["Emerald", "Gold"]}, {"name": "Galaxy", "palette": ["Deep blue", "Purple", "Black"]}, {"name": "Sunset", "palette": ["Amber", "Rose pink", "Gold"]}, {"name": "Blossom", "palette": ["Rose pink", "Pearl white"]}, {"name": "Geode", "palette": ["Clear", "Purple", "Gold"]}]'::jsonb)
$$;
create or replace function private.resinate_quote(p_items jsonb, out low int, out high int, out is_open boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  p jsonb := private.resinate_prices();
  ds jsonb := private.resinate_designs();
  it jsonb; sz text; q int; lo int; hi int; v int; theme_ok boolean; dye_free boolean;
begin
  low := 0; high := 0; is_open := false;
  for it in select e from jsonb_array_elements(p_items) e loop
    sz := it ->> 'size';
    q := (it ->> 'qty')::int;
    lo := (p -> 'base' ->> sz)::int; hi := lo;
    if (it ->> 'print')::boolean then v := (p -> 'print' ->> sz)::int; lo := lo + v; hi := hi + v; end if;
    -- a themed design has its own price, which includes its colours; other colours bring back the dye charge
    theme_ok := not coalesce((it ->> 'print')::boolean, false) and coalesce(it ->> 'theme', '') <> ''
                and exists (select 1 from jsonb_array_elements(ds) d where d ->> 'name' = it ->> 'theme');
    if theme_ok then v := coalesce((p -> 'theme' ->> sz)::int, 0); lo := lo + v; hi := hi + v; end if;
    dye_free := theme_ok and exists (
      select 1 from jsonb_array_elements(ds) d
      where d ->> 'name' = it ->> 'theme'
        and not exists (select 1 from jsonb_array_elements_text(coalesce(it -> 'palette', '[]'::jsonb)) c where not ((d -> 'palette') ? c)));
    if (it ->> 'colours')::int >= 2 and not dye_free then v := (p ->> 'dye')::int; lo := lo + v; hi := hi + v; end if;
    if (it ->> 'sparkle')::boolean then
      if sz = 'XL' then
        if jsonb_typeof(p -> 'sparkleXL') = 'number' and (p ->> 'sparkleXL')::int > 0 then
          v := (p ->> 'sparkleXL')::int; lo := lo + v; hi := hi + v;
        else is_open := true; end if;
      else
        lo := lo + (p ->> 'sparkleLo')::int; hi := hi + (p ->> 'sparkleHi')::int;
      end if;
    end if;
    if (it ->> 'led')::boolean and sz in ('L', 'XL') then
      v := coalesce((p -> 'led' ->> sz)::int, 0); lo := lo + v; hi := hi + v;
    end if;
    if (it ->> 'custom')::boolean then v := (p ->> 'customMin')::int; lo := lo + v; hi := hi + v; is_open := true; end if;
    if (p ->> 'bundleOff')::int > 0 and (it ->> 'print')::boolean and (it ->> 'colours')::int >= 2 and (it ->> 'sparkle')::boolean then
      v := (p ->> 'bundleOff')::int; lo := lo - v; hi := hi - v;
    end if;
    low := low + lo * q; high := high + hi * q;
  end loop;
end $$;

-- ── orders ───────────────────────────────────────────────────────
create table if not exists public.resinate_orders (
  ref text primary key check (ref ~ '^RSN-[A-Z0-9]{5}$'),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  contact text not null check (char_length(contact) between 1 and 200),
  pickup text not null default '' check (char_length(pickup) <= 80),
  notes text not null default '' check (char_length(notes) <= 2000),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  low int not null default 0,
  high int not null default 0,
  needs_quote boolean not null default false,
  price int check (price is null or price >= 0),         -- agreed total in cents; null until a maker sets it
  payments jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array'),  -- [{amount, method, at}]
  status text not null default 'New' check (status in ('New', 'Confirmed', 'Making', 'Ready', 'Collected', 'Cancelled')),
  source text not null default 'online' check (source in ('online', 'team')),
  created_by uuid default auth.uid()
);
alter table public.resinate_orders add column if not exists customer_id uuid references auth.users (id) on delete set null;
create index if not exists resinate_orders_created on public.resinate_orders (created_at desc);
create index if not exists resinate_orders_customer on public.resinate_orders (customer_id);
alter table public.resinate_orders enable row level security;
revoke all on public.resinate_orders from anon, authenticated;
grant select, insert, update, delete on public.resinate_orders to authenticated;
drop policy if exists "team only" on public.resinate_orders;
drop policy if exists "read orders" on public.resinate_orders;
create policy "read orders" on public.resinate_orders for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.resinate_role()) = 'maker');
drop policy if exists "makers add orders" on public.resinate_orders;
create policy "makers add orders" on public.resinate_orders for insert to authenticated
  with check ((select private.resinate_role()) = 'maker');
drop policy if exists "makers change orders" on public.resinate_orders;
create policy "makers change orders" on public.resinate_orders for update to authenticated
  using ((select private.resinate_role()) = 'maker') with check ((select private.resinate_role()) = 'maker');
drop policy if exists "makers remove orders" on public.resinate_orders;
create policy "makers remove orders" on public.resinate_orders for delete to authenticated
  using ((select private.resinate_role()) = 'maker');

-- tidy a list of pieces down to the known fields, rejecting anything out of range
create or replace function private.resinate_clean_items(p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare res jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'An order needs between 1 and 20 lines' using errcode = '22023';
  end if;
  -- palette: the colour names picked in the builder (up to 6); the dye charge counts at least that many colours
  -- theme: the name of one of our themed designs, or empty
  -- art / artText / artNote: a customer's own design (their uploaded picture's path, words, and a description)
  select jsonb_agg(jsonb_build_object(
      'size', e ->> 'size',
      'qty', coalesce((e ->> 'qty')::int, 1),
      'print', coalesce((e ->> 'print')::boolean, false),
      'colours', least(greatest(coalesce((e ->> 'colours')::int, 1), jsonb_array_length(pal.p), 1), 6),
      'palette', pal.p,
      'theme', left(coalesce(e ->> 'theme', ''), 30),
      'art', case when coalesce(e ->> 'art', '') ~ '^designs/[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,80}$' then e ->> 'art' else '' end,
      'artText', left(coalesce(e ->> 'artText', ''), 40),
      'artNote', left(coalesce(e ->> 'artNote', ''), 300),
      'sparkle', coalesce((e ->> 'sparkle')::boolean, false),
      'led', coalesce((e ->> 'led')::boolean, false) and (e ->> 'size') in ('L', 'XL'),
      'custom', coalesce((e ->> 'custom')::boolean, false),
      'customNote', left(coalesce(e ->> 'customNote', ''), 300)))
    into res
    from jsonb_array_elements(p_items) e
    cross join lateral (
      select coalesce(jsonb_agg(left(c.v, 24) order by c.n), '[]'::jsonb) as p
      from jsonb_array_elements_text(case when jsonb_typeof(e -> 'palette') = 'array' then e -> 'palette' else '[]'::jsonb end)
           with ordinality as c(v, n)
      where c.n <= 6 and length(trim(c.v)) > 0) pal;
  if exists (select 1 from jsonb_array_elements(res) e
             where (e ->> 'size') not in ('S', 'M', 'L', 'XL') or (e ->> 'qty')::int not between 1 and 20) then
    raise exception 'Each line needs a size (S, M, L or XL) and a quantity from 1 to 20' using errcode = '22023';
  end if;
  return res;
end $$;

-- a customer's order: priced here, so the page can't set its own price, payments or status.
-- A signed-in customer's order is linked to their account, so it shows on their profile.
create or replace function public.resinate_place_order(p_name text, p_contact text, p_pickup text, p_notes text, p_items jsonb)
returns table (ref text, price int, low int, high int, needs_quote boolean)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  clean jsonb := private.resinate_clean_items(p_items);
  q record; r text; fixed boolean; i int; b bytea;
  a constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if char_length(btrim(coalesce(p_name, ''))) = 0 or char_length(btrim(coalesce(p_contact, ''))) = 0 then
    raise exception 'Add a name and a way to contact you' using errcode = '22023';
  end if;
  if (select count(*) from public.resinate_orders o
      where o.source = 'online' and o.created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'Lots of orders are coming in right now. Try again in a few minutes.' using errcode = '53400';
  end if;
  select * into q from private.resinate_quote(clean);
  fixed := not q.is_open and q.low = q.high;
  loop
    b := uuid_send(gen_random_uuid()); r := 'RSN-';
    for i in 0..4 loop r := r || substr(a, 1 + get_byte(b, i) % length(a), 1); end loop;
    exit when not exists (select 1 from public.resinate_orders o where o.ref = r);
  end loop;
  insert into public.resinate_orders (ref, name, contact, pickup, notes, items, low, high, needs_quote, price, source, created_by, customer_id)
  values (r, left(btrim(p_name), 120), left(btrim(p_contact), 200), left(coalesce(p_pickup, ''), 80), left(coalesce(p_notes, ''), 2000),
          clean, q.low, q.high, not fixed, case when fixed then q.low end, 'online', auth.uid(),
          case when private.resinate_role() = 'maker' then null else auth.uid() end);
  return query select r, case when fixed then q.low end, q.low, q.high, not fixed;
end $$;
revoke all on function public.resinate_place_order(text, text, text, text, jsonb) from public;
grant execute on function public.resinate_place_order(text, text, text, text, jsonb) to anon, authenticated;

-- a customer checks their own order with its reference and the contact they gave (spaces and case ignored).
-- Returns no name or contact, and nothing at all when the pair doesn't match.
create or replace function public.resinate_order_status(p_ref text, p_contact text)
returns table (ref text, created_at timestamptz, status text, items jsonb, price int, low int, high int, needs_quote boolean, paid int)
language sql stable security definer set search_path = '' as $$
  select o.ref, o.created_at, o.status, o.items, o.price, o.low, o.high, o.needs_quote,
         coalesce((select sum((p ->> 'amount')::int) from jsonb_array_elements(o.payments) p), 0)::int
  from public.resinate_orders o
  where o.ref = upper(btrim(p_ref))
    and char_length(btrim(coalesce(p_contact, ''))) >= 3
    and lower(regexp_replace(o.contact, '\s', '', 'g')) = lower(regexp_replace(p_contact, '\s', '', 'g'))
$$;
revoke all on function public.resinate_order_status(text, text) from public;
grant execute on function public.resinate_order_status(text, text) to anon, authenticated;

-- ── messages from the "Message us" form ─────────────────────────
-- Anyone can send one through resinate_send_message() (rate-limited); only makers can read, mark or delete them.
create table if not exists public.resinate_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  contact text not null check (char_length(contact) between 3 and 200),
  order_ref text not null default '' check (char_length(order_ref) <= 20),
  body text not null check (char_length(body) between 1 and 3000),
  status text not null default 'New' check (status in ('New', 'Replied', 'Done')),
  customer_id uuid references auth.users (id) on delete set null
);
create index if not exists resinate_messages_created on public.resinate_messages (created_at desc);
alter table public.resinate_messages enable row level security;
revoke all on public.resinate_messages from anon, authenticated;
grant select, delete on public.resinate_messages to authenticated;
grant update (status) on public.resinate_messages to authenticated;
drop policy if exists "makers read messages" on public.resinate_messages;
create policy "makers read messages" on public.resinate_messages for select to authenticated
  using ((select private.resinate_role()) = 'maker');
drop policy if exists "makers mark messages" on public.resinate_messages;
create policy "makers mark messages" on public.resinate_messages for update to authenticated
  using ((select private.resinate_role()) = 'maker') with check ((select private.resinate_role()) = 'maker');
drop policy if exists "makers remove messages" on public.resinate_messages;
create policy "makers remove messages" on public.resinate_messages for delete to authenticated
  using ((select private.resinate_role()) = 'maker');

create or replace function public.resinate_send_message(p_name text, p_contact text, p_ref text, p_body text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) = 0 or char_length(btrim(coalesce(p_contact, ''))) < 3
     or char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Add your name, a way to reach you and a message' using errcode = '22023';
  end if;
  if (select count(*) from public.resinate_messages m where m.created_at > now() - interval '10 minutes') >= 30
     or (select count(*) from public.resinate_messages m
         where m.created_at > now() - interval '1 hour' and lower(m.contact) = lower(btrim(p_contact))) >= 5 then
    raise exception 'Lots of messages are coming in right now. Try again a bit later, or call us.' using errcode = '53400';
  end if;
  insert into public.resinate_messages (name, contact, order_ref, body, customer_id)
  values (left(btrim(p_name), 120), left(btrim(p_contact), 200), left(upper(btrim(coalesce(p_ref, ''))), 20),
          left(btrim(p_body), 3000), auth.uid());
end $$;
revoke all on function public.resinate_send_message(text, text, text, text) from public;
grant execute on function public.resinate_send_message(text, text, text, text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resinate_messages') then
    alter publication supabase_realtime add table public.resinate_messages;
  end if;
end $$;

-- live updates: the dashboard hears new and changed orders (row-level security still decides who sees them)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resinate_orders') then
    alter publication supabase_realtime add table public.resinate_orders;
  end if;
end $$;

-- ── photos ───────────────────────────────────────────────────────
create table if not exists public.resinate_photos (
  id uuid primary key default gen_random_uuid(),
  path text not null check (char_length(path) between 1 and 300),   -- object path in the 'resinate' bucket
  caption text not null default '' check (char_length(caption) <= 200),
  created_at timestamptz not null default now()
);
alter table public.resinate_photos enable row level security;
revoke all on public.resinate_photos from anon, authenticated;
grant select on public.resinate_photos to anon, authenticated;
grant insert, delete on public.resinate_photos to authenticated;
drop policy if exists "anyone reads" on public.resinate_photos;
create policy "anyone reads" on public.resinate_photos for select to anon, authenticated using (true);
drop policy if exists "editors add" on public.resinate_photos;
drop policy if exists "makers add" on public.resinate_photos;
create policy "makers add" on public.resinate_photos for insert to authenticated with check ((select private.resinate_role()) = 'maker');
drop policy if exists "editors remove" on public.resinate_photos;
drop policy if exists "makers remove" on public.resinate_photos;
create policy "makers remove" on public.resinate_photos for delete to authenticated using ((select private.resinate_role()) = 'maker');

-- the bucket is public, so anyone can view a photo by its link. Makers manage gallery files;
-- everyone manages their own profile photo under avatars/<account id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resinate', 'resinate', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "resinate editors upload" on storage.objects;
drop policy if exists "resinate editors read" on storage.objects;
drop policy if exists "resinate editors delete" on storage.objects;
drop policy if exists "resinate add files" on storage.objects;
create policy "resinate add files" on storage.objects for insert to authenticated
  with check (bucket_id = 'resinate' and ((select private.resinate_role()) = 'maker'
              or name like 'avatars/' || (select auth.uid())::text || '/%'
              or name like 'designs/' || (select auth.uid())::text || '/%'));
drop policy if exists "resinate read files" on storage.objects;
create policy "resinate read files" on storage.objects for select to authenticated
  using (bucket_id = 'resinate' and ((select private.resinate_role()) = 'maker'
         or name like 'avatars/' || (select auth.uid())::text || '/%'
         or name like 'designs/' || (select auth.uid())::text || '/%'));
drop policy if exists "resinate replace files" on storage.objects;
create policy "resinate replace files" on storage.objects for update to authenticated
  using (bucket_id = 'resinate' and name like 'avatars/' || (select auth.uid())::text || '/%')
  with check (bucket_id = 'resinate' and name like 'avatars/' || (select auth.uid())::text || '/%');
drop policy if exists "resinate remove files" on storage.objects;
create policy "resinate remove files" on storage.objects for delete to authenticated
  using (bucket_id = 'resinate' and ((select private.resinate_role()) = 'maker'
         or name like 'avatars/' || (select auth.uid())::text || '/%'
         or name like 'designs/' || (select auth.uid())::text || '/%'));

-- ── roles: console only ──────────────────────────────────────────
-- Everyone who signs up is a customer. To make someone a maker (they can open the dashboard, and change
-- prices, payment details and photos), they sign up on the site first, then you run, here in the console:
--   update public.resinate_profiles set role = 'maker' where email = 'their@email.com';
-- To take it away:  update public.resinate_profiles set role = 'customer' where email = 'their@email.com';
-- Or list an email before they sign up, and they start as a maker:
--   insert into public.resinate_staff (email) values ('their@email.com') on conflict do nothing;
-- See who's a maker:  select email, display_name, role from public.resinate_profiles order by role, email;
