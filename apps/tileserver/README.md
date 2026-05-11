# pg_tileserv service

Run pg_tileserv against the same Supabase/Postgres database.

Required env:
- `DATABASE_URL`
- `TS_HTTP_PORT`

Expected parcel endpoint:
`/public.parcels/{z}/{x}/{y}.pbf`

`public.parcels` should expose columns:
- `id`
- `inspire_id`
- `area_acres`
- `area_hectares`
- `geom`
