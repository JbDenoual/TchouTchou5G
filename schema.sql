-- À exécuter une fois dans Supabase : Dashboard > SQL Editor > New query.

create table if not exists public.trips (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  started_at timestamptz not null,
  ended_at timestamptz,
  ping_interval_ms integer not null,
  ping_timeout_ms integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pings (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  sent_at timestamptz not null,
  resolved_at timestamptz not null,
  start_lat double precision,
  start_lng double precision,
  start_accuracy double precision,
  end_lat double precision,
  end_lng double precision,
  end_accuracy double precision,
  elapsed_ms integer not null,
  success boolean not null
);

create index if not exists pings_trip_id_idx on public.pings (trip_id, sent_at);

alter table public.trips enable row level security;
alter table public.pings enable row level security;

create policy "trips_owner_all" on public.trips
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "pings_owner_all" on public.pings
  for all
  using (exists (select 1 from public.trips t where t.id = pings.trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.trips t where t.id = pings.trip_id and t.user_id = auth.uid()));
