# Supabase Setup (Production GIS Pipeline)

## 1) Database SQL
Run `packages/db/sql/001_init.sql` in Supabase SQL Editor.

This creates:
- `public.parcels` for production parcel storage (PostGIS geometry, area metrics, centroid)
- `public.gis_processing_jobs` queue table for admin upload pipeline
- GIST indexes for scalable spatial querying

## 2) Storage Bucket
Create bucket:
- Name: `gis-uploads`
- Access: private
- Limit: configure for 1GB+ objects

## 3) Row-Level Security
Recommended:
- Keep `parcels` readable via anon role if public map is open
- Restrict `gis_processing_jobs` to service role/admin only
- Restrict `storage.objects` in `gis-uploads` to authenticated admins + service role

## 4) Required Environment Variables
### Web (Vercel)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `NEXT_PUBLIC_TILESERVER_URL`

### Worker (Railway)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POSTGRES_OGR_DSN` (e.g. `PG:host=... dbname=... user=... password=... sslmode=require`)
- `POSTGRES_DSN` (psql DSN for finalize SQL)

### pg_tileserv
- `DATABASE_URL`

## 5) Queue + Processing Flow
1. `/admin/gis` uploads `.gml` to Supabase Storage bucket `gis-uploads`.
2. Web app inserts `gis_processing_jobs` row with `queued` status.
3. Railway worker polls queue, downloads file, runs `ogr2ogr` directly into PostGIS.
4. Worker runs finalize SQL to normalize geometry, calculate area values, build parcel-ready rows.
5. `pg_tileserv` immediately serves parcels as vector tiles.

## 6) ogr2ogr Command Pattern
```bash
ogr2ogr -f PostgreSQL \
  "PG:host=HOST dbname=DB user=USER password=PASS sslmode=require" \
  uploaded.gml \
  -nln staging_parcels \
  -nlt PROMOTE_TO_MULTI \
  -lco GEOMETRY_NAME=geom \
  -t_srs EPSG:4326 \
  -overwrite
```

## 7) Scale Notes
- Never export national parcel data to GeoJSON for frontend.
- Keep parcel delivery tile-based through `pg_tileserv`.
- Use database-side filtering/scoring tables for V2 and V3 intelligence layers.
- Partition parcel tables by geography/date when national scale grows.
