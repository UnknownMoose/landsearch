create extension if not exists postgis;

create table if not exists public.parcels (
  id bigserial primary key,
  title_number text,
  inspire_id text unique,
  geom geometry(MultiPolygon, 4326) not null,
  area_m2 numeric,
  area_acres numeric,
  area_hectares numeric,
  centroid geometry(Point, 4326),
  created_at timestamptz default now()
);

create index if not exists parcels_geom_gix on public.parcels using gist (geom);
create index if not exists parcels_centroid_gix on public.parcels using gist (centroid);
create index if not exists parcels_inspire_id_idx on public.parcels (inspire_id);

create table if not exists public.gis_processing_jobs (
  id bigserial primary key,
  storage_path text not null,
  original_filename text not null,
  status text not null check (status in ('queued','processing','completed','failed','inactive')),
  logs text,
  is_active boolean default true,
  retry_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
