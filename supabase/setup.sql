-- Resinate: orders, team, settings and photos, for the shop's Supabase project.
-- Paste this whole file into the project's SQL Editor and run it. It is safe to run again after an update.
--
-- resinate_staff     who can open the dashboard, by sign-in email: 'staff' take orders and record payments,
--                    'editor' also change prices, payment details, photos and the team list.
-- resinate_settings  'prices' and 'payment'. Everyone can read them (the shop shows them); only editors change them.
-- resinate_orders    every order. Customers can't read or change orders: they place one only through
--                    resinate_place_order(), which prices it on the server from resinate_settings.
-- resinate_photos    the "Our work" gallery; the files live in the public storage bucket 'resinate'.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ── team ─────────────────────────────────────────────────────────
create table if not exists public.resinate_staff (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'staff' check (role in ('staff', 'editor')),
  added_at timestamptz not null default now()
);
alter table public.resinate_staff enable row level security;
revoke all on public.resinate_staff from anon, authenticated;
grant select on public.resinate_staff to authenticated;
drop policy if exists "see yourself" on public.resinate_staff;
create policy "see yourself" on public.resinate_staff for select to authenticated
  using (email = lower((select auth.jwt()) ->> 'email'));

-- the signed-in person's role, or null when they aren't on the team
create or replace function private.resinate_role() returns text language sql stable security definer set search_path = '' as $$
  select s.role from public.resinate_staff s where s.email = lower(auth.jwt() ->> 'email')
$$;
create or replace function public.resinate_my_role() returns text language sql stable security definer set search_path = '' as $$
  select private.resinate_role()
$$;
revoke all on function public.resinate_my_role() from public, anon;
grant execute on function public.resinate_my_role() to authenticated;

-- editors add and remove team members from the dashboard
grant insert, update, delete on public.resinate_staff to authenticated;
drop policy if exists "editors manage the team" on public.resinate_staff;
create policy "editors manage the team" on public.resinate_staff for all to authenticated
  using ((select private.resinate_role()) = 'editor') with check ((select private.resinate_role()) = 'editor');

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
create policy "editors write" on public.resinate_settings for all to authenticated
  using ((select private.resinate_role()) = 'editor') with check ((select private.resinate_role()) = 'editor');

-- prices in cents: the defaults, overridden by whatever editors saved
create or replace function private.resinate_prices() returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select coalesce((select data from public.resinate_settings where id = 'prices'), '{}'::jsonb) as d),
  def as (select '{"base":{"S":599,"M":999,"L":1399,"XL":1999},"print":{"S":199,"M":199,"L":299,"XL":299},
                   "dye":99,"sparkleLo":100,"sparkleHi":149,"sparkleXL":null,"led":{"L":449,"XL":399},
                   "customMin":200,"bundleOff":0}'::jsonb as d)
  select def.d || (s.d - 'base' - 'print' - 'led') || jsonb_build_object(
    'base',  (def.d -> 'base')  || coalesce(s.d -> 'base',  '{}'::jsonb),
    'print', (def.d -> 'print') || coalesce(s.d -> 'print', '{}'::jsonb),
    'led',   (def.d -> 'led')   || coalesce(s.d -> 'led',   '{}'::jsonb))
  from s, def
$$;

-- what a list of pieces costs: the same rules as the shop page
create or replace function private.resinate_quote(p_items jsonb, out low int, out high int, out is_open boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  p jsonb := private.resinate_prices();
  it jsonb; sz text; q int; lo int; hi int; v int;
begin
  low := 0; high := 0; is_open := false;
  for it in select e from jsonb_array_elements(p_items) e loop
    sz := it ->> 'size';
    q := (it ->> 'qty')::int;
    lo := (p -> 'base' ->> sz)::int; hi := lo;
    if (it ->> 'print')::boolean then v := (p -> 'print' ->> sz)::int; lo := lo + v; hi := hi + v; end if;
    if (it ->> 'colours')::int >= 2 then v := (p ->> 'dye')::int; lo := lo + v; hi := hi + v; end if;
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
  price int check (price is null or price >= 0),         -- agreed total in cents; null until the team sets it
  payments jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array'),  -- [{amount, method, at}]
  status text not null default 'New' check (status in ('New', 'Confirmed', 'Making', 'Ready', 'Collected', 'Cancelled')),
  source text not null default 'online' check (source in ('online', 'team')),
  created_by uuid default auth.uid()
);
create index if not exists resinate_orders_created on public.resinate_orders (created_at desc);
alter table public.resinate_orders enable row level security;
revoke all on public.resinate_orders from anon, authenticated;
grant select, insert, update, delete on public.resinate_orders to authenticated;
drop policy if exists "team only" on public.resinate_orders;
create policy "team only" on public.resinate_orders for all to authenticated
  using ((select private.resinate_role()) is not null) with check ((select private.resinate_role()) is not null);

-- tidy a list of pieces down to the known fields, rejecting anything out of range
create or replace function private.resinate_clean_items(p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare res jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'An order needs between 1 and 20 lines' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object(
      'size', e ->> 'size',
      'qty', coalesce((e ->> 'qty')::int, 1),
      'print', coalesce((e ->> 'print')::boolean, false),
      'colours', least(greatest(coalesce((e ->> 'colours')::int, 1), 1), 6),
      'sparkle', coalesce((e ->> 'sparkle')::boolean, false),
      'led', coalesce((e ->> 'led')::boolean, false) and (e ->> 'size') in ('L', 'XL'),
      'custom', coalesce((e ->> 'custom')::boolean, false),
      'customNote', left(coalesce(e ->> 'customNote', ''), 300)))
    into res from jsonb_array_elements(p_items) e;
  if exists (select 1 from jsonb_array_elements(res) e
             where (e ->> 'size') not in ('S', 'M', 'L', 'XL') or (e ->> 'qty')::int not between 1 and 20) then
    raise exception 'Each line needs a size (S, M, L or XL) and a quantity from 1 to 20' using errcode = '22023';
  end if;
  return res;
end $$;

-- a customer's order: priced here, so the page can't set its own price, payments or status
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
  insert into public.resinate_orders (ref, name, contact, pickup, notes, items, low, high, needs_quote, price, source, created_by)
  values (r, left(btrim(p_name), 120), left(btrim(p_contact), 200), left(coalesce(p_pickup, ''), 80), left(coalesce(p_notes, ''), 2000),
          clean, q.low, q.high, not fixed, case when fixed then q.low end, 'online', auth.uid());
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
create policy "editors add" on public.resinate_photos for insert to authenticated with check ((select private.resinate_role()) = 'editor');
drop policy if exists "editors remove" on public.resinate_photos;
create policy "editors remove" on public.resinate_photos for delete to authenticated using ((select private.resinate_role()) = 'editor');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resinate', 'resinate', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "resinate editors upload" on storage.objects;
create policy "resinate editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'resinate' and (select private.resinate_role()) = 'editor');
drop policy if exists "resinate editors read" on storage.objects;
create policy "resinate editors read" on storage.objects for select to authenticated
  using (bucket_id = 'resinate' and (select private.resinate_role()) = 'editor');   -- removing a file needs select too
drop policy if exists "resinate editors delete" on storage.objects;
create policy "resinate editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'resinate' and (select private.resinate_role()) = 'editor');

-- ── first editor ─────────────────────────────────────────────────
-- Put your own sign-in email here, uncomment, and run it once. After that, add the rest of the team from the
-- dashboard's Team section (or in Table Editor → resinate_staff). The dashboard also shows this line with your
-- email filled in when you sign in before you're on the list.
-- insert into public.resinate_staff (email, role) values ('you@example.com', 'editor') on conflict (email) do update set role = excluded.role;
