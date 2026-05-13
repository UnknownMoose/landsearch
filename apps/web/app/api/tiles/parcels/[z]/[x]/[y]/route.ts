import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dsn = process.env.POSTGRES_DSN;
if (!dsn) {
  console.error("[tiles/parcels] Missing POSTGRES_DSN environment variable");
}

const connectionString = dsn ?? "postgresql://invalid";
const parsedDsn = (() => {
  try {
    return new URL(connectionString);
  } catch {
    return null;
  }
})();

const sslMode = parsedDsn?.searchParams.get("sslmode")?.toLowerCase();
const shouldDisableSsl = sslMode === "disable";

if (parsedDsn) {
  // Force node-postgres to use runtime SSL settings instead of file-based cert validation
  // options that can break in managed/serverless environments.
  parsedDsn.searchParams.delete("sslcert");
  parsedDsn.searchParams.delete("sslkey");
  parsedDsn.searchParams.delete("sslrootcert");
}

const normalizedConnectionString = parsedDsn?.toString() ?? connectionString;

const pool = new Pool({
  connectionString: normalizedConnectionString,
  ssl: shouldDisableSsl ? false : { rejectUnauthorized: false }
});

pool.on("error", (error: Error) => {
  console.error("[tiles/parcels] PostgreSQL pool error", error);
});

function invalidTileResponse() {
  return Response.json(
    { error: "Invalid tile coordinates. Expected numeric z/x/y with x,y in [0, 2^z)." },
    { status: 400 }
  );
}

export async function GET(_: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const startedAt = Date.now();

  if (!dsn) {
    return Response.json(
      { error: "Server misconfiguration: POSTGRES_DSN is not set." },
      { status: 500 }
    );
  }

  try {
    const { z, x, y } = await params;
    const zi = Number(z);
    const xi = Number(x);
    const yi = Number(y);

    if (![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > 22) {
      return invalidTileResponse();
    }

    const limit = 2 ** zi;
    if (xi < 0 || yi < 0 || xi >= limit || yi >= limit) {
      return invalidTileResponse();
    }

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

    const elapsedMs = Date.now() - startedAt;
    const sizeBytes = Buffer.isBuffer(mvt) ? mvt.length : Buffer.byteLength(mvt);
    console.info(`[tiles/parcels] z=${zi} x=${xi} y=${yi} bytes=${sizeBytes} latency_ms=${elapsedMs}`);

    return new Response(mvt, {
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": "public, max-age=120, s-maxage=600, stale-while-revalidate=86400"
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[tiles/parcels] Unhandled route error", error);

    return Response.json(
      { error: "Tile generation failed.", details: message },
      { status: 500 }
    );
  }
}
