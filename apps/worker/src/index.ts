import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import http from "node:http";

const exec = promisify(execFile);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const supabaseUrl = requireEnv("SUPABASE_URL");
const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const dbUrl = requireEnv("POSTGRES_OGR_DSN");
const postgresDsn = requireEnv("POSTGRES_DSN");

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function updateJob(id: number, status: string, logs: string) {
  const { error } = await supabase.from("gis_processing_jobs").update({ status, logs }).eq("id", id);
  if (error) {
    console.error(`Failed to update job ${id} status to ${status}:`, error.message);
  }
}

async function runCommand(name: string, file: string, args: string[], timeoutMs = 15 * 60 * 1000) {
  console.log(`[job] ${name} start`);
  const { stdout, stderr } = await exec(file, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
  if (stdout?.trim()) console.log(`[job] ${name} stdout:\n${stdout.trim()}`);
  if (stderr?.trim()) console.log(`[job] ${name} stderr:\n${stderr.trim()}`);
  console.log(`[job] ${name} done`);
}

async function processJob(job: any) {
  await updateJob(job.id, "processing", "Downloading upload from storage");

  await mkdir("/tmp/gml", { recursive: true });
  const sourceExt = extname(job.original_filename ?? "").toLowerCase();
  const localExt = sourceExt === ".zip" ? ".zip" : ".gml";
  const localPath = `/tmp/gml/${job.id}${localExt}`;

  const { data, error: downloadError } = await supabase.storage.from("gis-uploads").download(job.storage_path);
  if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`);
  if (!data) throw new Error("Failed to download source file from storage");

  await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  await updateJob(job.id, "processing", "Downloaded upload, importing with ogr2ogr");

  await runCommand(
    "ogr2ogr",
    "ogr2ogr",
    [
      "-f",
      "PostgreSQL",
      dbUrl,
      localPath,
      "-nln",
      "staging_parcels",
      "-nlt",
      "PROMOTE_TO_MULTI",
      "-lco",
      "GEOMETRY_NAME=geom",
      "-t_srs",
      "EPSG:4326",
      "-overwrite"
    ]
  );

  await updateJob(job.id, "processing", "Running finalize.sql");
  await runCommand("psql finalize", "psql", [postgresDsn, "-f", "/app/sql/finalize.sql"]);

  await updateJob(job.id, "completed", "Imported and indexed");
}

async function run() {
  while (true) {
    try {
      const { data: job, error } = await supabase
        .from("gis_processing_jobs")
        .select("*")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Failed to poll queued jobs:", error.message);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      if (!job) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      try {
        await processJob(job);
      } catch (e: any) {
        console.error(`Job ${job.id} failed:`, e?.message ?? e);
        await updateJob(job.id, "failed", e?.message ?? "Unknown worker error");
      }
    } catch (e: any) {
      console.error("Worker loop error:", e?.message ?? e);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

// Start HTTP health server for Railway
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
  } else {
    res.writeHead(404);
    res.end();
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Health check listening on port ${port}`);
});

// Start the polling loop
run();


let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down worker...`);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});


process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
