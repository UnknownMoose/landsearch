insert into public.parcels (title_number, inspire_id, geom, area_m2, area_hectares, area_acres, centroid)
select
  null::text as title_number,
  coalesce(
    nullif(nationalcadastralreference::text, ''),
    nullif(inspireid::text, ''),
    ogc_fid::text
  ) as inspire_id,
  st_multi(geom)::geometry(MultiPolygon, 4326),
  st_area(geography(st_transform(geom, 4326))) as area_m2,
  st_area(geography(st_transform(geom, 4326))) / 10000.0 as area_hectares,
  st_area(geography(st_transform(geom, 4326))) / 4046.8564224 as area_acres,
  st_centroid(st_transform(geom, 4326))::geometry(Point, 4326)
from public.staging_parcels
where geom is not null
on conflict (inspire_id) do update set
  title_number = excluded.title_number,
  geom = excluded.geom,
  area_m2 = excluded.area_m2,
  area_hectares = excluded.area_hectares,
  area_acres = excluded.area_acres,
  centroid = excluded.centroid;

truncate table public.staging_parcels;
