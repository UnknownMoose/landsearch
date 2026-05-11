# Landsearch MVP (GML -> PostGIS -> Vector Tiles -> MapLibre)

Monorepo structure:
- `apps/web` Next.js App Router frontend and admin GIS upload UI (`/admin/gis`)
- `apps/worker` Railway worker for async GDAL `ogr2ogr` imports
- `apps/tileserver` pg_tileserv deployment notes
- `packages/db` SQL setup for PostGIS tables + job queue
- `docs/supabase-setup.md` full Supabase setup guide

Core architecture avoids browser GIS parsing and giant GeoJSON.
