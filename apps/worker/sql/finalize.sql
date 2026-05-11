insert into public.parcels (title_number, inspire_id, geom, area_m2, area_hectares, area_acres, centroid)
select
  nullif(title_number::text, ''),
  coalesce(inspire_id::text, ogc_fid::text),
  st_multi(geom)::geometry(MultiPolygon, 4326),
  st_area(geography(st_transform(geom, 4326))) as area_m2,
  st_area(geography(st_transform(geom, 4326))) / 10000.0 as area_hectares,
  st_area(geography(st_transform(geom, 4326))) / 4046.8564224 as area_acres,
  st_centroid(st_transform(geom, 4326))::geometry(Point, 4326)
from public.staging_parcels;

truncate table public.staging_parcels;
