import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import http from "node:http";

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

  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["ignore", "inherit", "inherit"]
    });

    const killTimer = setTimeout(() => {
      console.error(`[job] ${name} timed out after ${timeoutMs}ms`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(killTimer);

      if (signal) {
        reject(new Error(`${name} terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${name} exited with code ${code}`));
        return;
      }

      console.log(`[job] ${name} done`);
      resolve();
    });
  });
}

async function processJob(job: any) {
  await updateJob(job.id, "processing", "Downloading upload from storage");

  await mkdir("/tmp/gml", { recursive: true });
  const sourceExt = extname(job.original_filename ?? "").toLowerCase();
  const localExt = sourceExt === ".zip" ? ".zip" : ".gml";
  const localPath = `/tmp/gml/${job.id}${localExt}`;

  try {
    const { data: signedData, error: signedUrlError } = await supabase.storage
      .from("gis-uploads")
      .createSignedUrl(job.storage_path, 60 * 15);
    if (signedUrlError) throw new Error(`Failed to create signed URL: ${signedUrlError.message}`);
    if (!signedData?.signedUrl) throw new Error("Failed to create signed URL for source file");

    const downloadResponse = await fetch(signedData.signedUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Storage download failed: HTTP ${downloadResponse.status}`);
    }
    if (!downloadResponse.body) {
      throw new Error("Storage download failed: missing response stream");
    }

    await updateJob(job.id, "processing", "Downloading source file to worker disk");
    const sourceFile = createWriteStream(localPath, { flags: "w" });
    await pipeline(Readable.fromWeb(downloadResponse.body as any), sourceFile);

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
  } finally {
    await rm(localPath, { force: true });
  }
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
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  res.writeHead(404);
  res.end();
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Health check listening on port ${port}`);
});

// Start the polling loop
run().catch((e) => {
  console.error("Fatal error in worker loop:", e);
  process.exit(1);
});


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
