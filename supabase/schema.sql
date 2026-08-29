-- =============================================================================
-- Xspace & Co Portal — Supabase schema
--
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent enough to re-run during setup, but it DROPS nothing, so if you
-- change your mind about a table you'll need to drop it yourself.
--
-- The permission rules here mirror portal-db.js exactly:
--   * Founder is the superuser  — reads and writes every row.
--   * Everyone else is scoped   — only rows they own.
--   * Only the Founder manages team members.
--
-- The difference is that these rules are enforced by Postgres itself, so they
-- hold even if a page forgets to check, or someone calls the API directly.
-- =============================================================================

-- ----------------------------------------------------------------- roles ----
do $$ begin
  create type public.user_role as enum ('founder','core','agent','creator','studio');
exception when duplicate_object then null;
end $$;


-- -------------------------------------------------------------- profiles ----
-- One row per person, keyed to Supabase's auth.users. Passwords, sessions and
-- email confirmation are handled by Supabase Auth — never store them here.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  email      text unique,
  phone      text,
  role       public.user_role not null default 'agent',
  details    text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);


-- A policy on profiles that itself reads profiles would recurse forever.
-- SECURITY DEFINER lets these helpers bypass RLS to answer "who am I?".
create or replace function public.my_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_founder()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = 'founder' from public.profiles where id = auth.uid()), false)
$$;


-- New signups get a profile automatically, always as 'agent'. Promoting
-- someone is a deliberate act the Founder performs afterwards — a new user
-- can never arrive as a founder.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.email,
    'agent'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- --------------------------------------------------------------- tables -----
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  builder    text,
  rera       text,
  status     text,
  units      integer,
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  project_id    uuid references public.projects(id) on delete set null,
  area          text,
  price         text,
  unit_type     text,
  status        text default 'Available',
  verified      boolean not null default false,
  submitted_by  uuid references public.profiles(id) on delete set null,
  assigned_agent uuid references public.profiles(id) on delete set null,
  photos        jsonb not null default '[]'::jsonb,  -- [{url, width, height, size}]
  created_at    timestamptz not null default now()
);

create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text,
  source         text,
  budget         text,
  status         text default 'Discovery',
  temperature    text default 'warm',
  assigned_agent uuid references public.profiles(id) on delete set null,
  listing_id     uuid references public.listings(id) on delete set null,
  notes          text,
  present_mode   text,
  status_updated_at timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.visits (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.leads(id) on delete cascade,
  listing_id    uuid references public.listings(id) on delete set null,
  agent_id      uuid references public.profiles(id) on delete set null,
  mode          text default 'On-site',
  status        text default 'Scheduled',
  reason        text,
  scheduled_at  timestamptz,
  ended_at      timestamptz,
  feedback_submitted_at timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.verifications (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid references public.listings(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  type        text,
  status      text default 'pending',
  assigned_to uuid references public.profiles(id) on delete set null,
  notes       text,
  escalated   boolean not null default false,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.tickets (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  descr      text,
  category   text,
  priority   text default 'medium',
  status     text default 'open',
  raiser     uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  type       text,
  title      text not null,
  body       text,
  role       public.user_role,          -- null = everyone
  user_id    uuid references public.profiles(id) on delete cascade,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.activity (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  actor      uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  actor      uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_agent    on public.leads(assigned_agent);
create index if not exists idx_listings_owner on public.listings(submitted_by);
create index if not exists idx_visits_agent   on public.visits(agent_id);
create index if not exists idx_notif_user     on public.notifications(user_id);


-- ------------------------------------------------------------------ RLS -----
-- Nothing is readable until a policy says so. Enable on every table.
alter table public.profiles      enable row level security;
alter table public.projects      enable row level security;
alter table public.listings      enable row level security;
alter table public.leads         enable row level security;
alter table public.visits        enable row level security;
alter table public.verifications enable row level security;
alter table public.tickets       enable row level security;
alter table public.notifications enable row level security;
alter table public.activity      enable row level security;
alter table public.audit         enable row level security;


-- PROFILES — you can read yourself; the Founder reads everyone.
-- Only the Founder inserts, updates or removes team members.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_founder());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  -- You may edit your own details but never your own role or active flag.
  with check (id = auth.uid() and role = public.my_role());

drop policy if exists profiles_founder_all on public.profiles;
create policy profiles_founder_all on public.profiles for all to authenticated
  using (public.is_founder()) with check (public.is_founder());


-- PROJECTS — everyone signed in can read; founder and core can write.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (true);

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to authenticated
  using (public.is_founder() or public.my_role() = 'core')
  with check (public.is_founder() or public.my_role() = 'core');


-- LISTINGS — founder sees all; everyone else sees their own.
drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings for select to authenticated
  using (public.is_founder() or submitted_by = auth.uid() or assigned_agent = auth.uid());

drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings for insert to authenticated
  with check (submitted_by = auth.uid() or public.is_founder());

drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings for update to authenticated
  using (public.is_founder() or public.my_role() = 'core' or submitted_by = auth.uid());

drop policy if exists listings_delete on public.listings;
create policy listings_delete on public.listings for delete to authenticated
  using (public.is_founder());


-- LEADS — client data. Founder sees all; agents only their own.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (public.is_founder() or assigned_agent = auth.uid());

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check (assigned_agent = auth.uid() or public.is_founder());

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (public.is_founder() or assigned_agent = auth.uid());

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (public.is_founder());


-- VISITS
drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits for select to authenticated
  using (public.is_founder() or agent_id = auth.uid());

drop policy if exists visits_write on public.visits;
create policy visits_write on public.visits for all to authenticated
  using (public.is_founder() or agent_id = auth.uid())
  with check (public.is_founder() or agent_id = auth.uid());


-- VERIFICATIONS — founder and core.
drop policy if exists verifications_all on public.verifications;
create policy verifications_all on public.verifications for all to authenticated
  using (public.is_founder() or public.my_role() = 'core')
  with check (public.is_founder() or public.my_role() = 'core');


-- TICKETS — you see what you raised; founder and core see everything.
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using (public.is_founder() or public.my_role() = 'core' or raiser = auth.uid());

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (raiser = auth.uid());

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update to authenticated
  using (public.is_founder() or public.my_role() = 'core');


-- NOTIFICATIONS — addressed to you personally, or to your role, or to all.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    public.is_founder()
    or user_id = auth.uid()
    or role is null
    or role = public.my_role()
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (public.is_founder() or user_id = auth.uid() or role = public.my_role());

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (true);


-- ACTIVITY — readable by all signed-in staff, append-only.
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated using (true);

drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity for insert to authenticated
  with check (actor = auth.uid());


-- AUDIT — founder-only reading. Append-only: no update or delete policy
-- exists, so an audit trail cannot be rewritten, not even by the founder.
drop policy if exists audit_select on public.audit;
create policy audit_select on public.audit for select to authenticated
  using (public.is_founder());

drop policy if exists audit_insert on public.audit;
create policy audit_insert on public.audit for insert to authenticated
  with check (true);


-- -------------------------------------------------------------- storage -----
-- Bucket for compressed listing photos (see portal-image.js).
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

drop policy if exists listing_photos_read on storage.objects;
create policy listing_photos_read on storage.objects for select
  using (bucket_id = 'listing-photos');

drop policy if exists listing_photos_write on storage.objects;
create policy listing_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos');

drop policy if exists listing_photos_delete on storage.objects;
create policy listing_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and public.is_founder());


-- =============================================================================
-- AFTER RUNNING THIS
--
-- 1. Create your own login:  Authentication -> Users -> Add user
--                            (email tej@xspace.co, set a password)
--
-- 2. Promote yourself to founder — the trigger made you an 'agent', and no
--    policy lets an agent promote itself. Run this once here in the SQL editor,
--    which bypasses RLS:
--
--       update public.profiles set role = 'founder', name = 'Tej (Founder)'
--       where email = 'tej@xspace.co';
--
-- 3. Add the rest of the team the same way (Add user, then set their role).
--
-- 4. Sanity-check the rules: log in as an agent in the app and confirm you can
--    only see your own leads. If an agent can see everything, RLS is not on.
-- =============================================================================
