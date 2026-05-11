# Landsearch MVP (GML -> PostGIS -> Vector Tiles -> MapLibre)

Production footprint:
- Vercel: Next.js frontend + vector tile API endpoint
- Supabase: PostGIS + Storage + job queue
- Tiny worker (Railway/Render): only GDAL `ogr2ogr` imports

Monorepo structure:
- `apps/web` Next.js App Router frontend, admin GIS upload UI (`/admin/gis`), and `/api/tiles/parcels/{z}/{x}/{y}` MVT endpoint.
- `apps/worker` async GML import worker.
- `packages/db` SQL setup for PostGIS tables + queue.
- `docs/supabase-setup.md` full setup guide.
