import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.POSTGRES_DSN });

export async function GET(_: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const zi = Number(z); const xi = Number(x); const yi = Number(y);

  const sql = `
with bounds as (
  select ST_TileEnvelope($1, $2, $3) as geom_3857
),
raw as (
  select
    id,
    inspire_id,
    area_acres,
    area_hectares,
    ST_AsMVTGeom(
      ST_Transform(p.geom, 3857),
      bounds.geom_3857,
      4096,
      64,
      true
    ) as geom
  from public.parcels p
  cross join bounds
  where ST_Intersects(ST_Transform(p.geom, 3857), bounds.geom_3857)
)
select ST_AsMVT(raw, 'parcels', 4096, 'geom') as mvt from raw;`;

  const { rows } = await pool.query(sql, [zi, xi, yi]);
  const mvt = rows[0]?.mvt ?? Buffer.alloc(0);

  return new Response(mvt, {
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": "public, max-age=120, s-maxage=600, stale-while-revalidate=86400"
    }
  });
}
