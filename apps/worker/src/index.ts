import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";

const exec = promisify(execFile);
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const dbUrl = process.env.POSTGRES_OGR_DSN!;

async function run() {
  while (true) {
    const { data: job } = await supabase.from("gis_processing_jobs")
      .select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!job) {
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }

    await supabase.from("gis_processing_jobs").update({ status: "processing" }).eq("id", job.id);
    try {
      await mkdir("/tmp/gml", { recursive: true });
      const localPath = `/tmp/gml/${job.id}.gml`;
      const { data } = await supabase.storage.from("gis-uploads").download(job.storage_path);
      await writeFile(localPath, Buffer.from(await data.arrayBuffer()));

      await exec("ogr2ogr", ["-f", "PostgreSQL", dbUrl, localPath, "-nln", "staging_parcels", "-nlt", "PROMOTE_TO_MULTI", "-lco", "GEOMETRY_NAME=geom", "-t_srs", "EPSG:4326", "-overwrite"]);
      await exec("psql", [process.env.POSTGRES_DSN!, "-f", "/app/sql/finalize.sql"]);

      await supabase.from("gis_processing_jobs").update({ status: "completed", logs: "Imported and indexed" }).eq("id", job.id);
    } catch (e: any) {
      await supabase.from("gis_processing_jobs").update({ status: "failed", logs: e.message }).eq("id", job.id);
    }
  }
}

run();
