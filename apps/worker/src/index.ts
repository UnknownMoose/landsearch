import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdir, rm, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
let lastPollAt: string | null = null;
let lastClaimedJobAt: string | null = null;
let lastCompletedJobAt: string | null = null;
const jobLogHistory = new Map<number, string>();

async function updateJob(id: number, status: string, logs: string) {
  const stampedLog = `[${new Date().toISOString()}] ${logs}`;
  const existing = jobLogHistory.get(id);
  const combinedLogs = existing ? `${existing}\n${stampedLog}` : stampedLog;
  jobLogHistory.set(id, combinedLogs);

  const { error } = await supabase.from("gis_processing_jobs").update({ status, logs: combinedLogs }).eq("id", id);
  if (error) {
    console.error(`Failed to update job ${id} status to ${status}:`, error.message);
  }
}

async function claimNextQueuedJob() {
  lastPollAt = new Date().toISOString();
  const { data: nextJob, error: pollError } = await supabase
    .from("gis_processing_jobs")
    .select("id")
    .eq("status", "queued")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pollError) {
    throw new Error(`Failed to poll queued jobs: ${pollError.message}`);
  }

  if (!nextJob) return null;

  const { data: claimedJob, error: claimError } = await supabase
    .from("gis_processing_jobs")
    .update({ status: "processing", logs: "Worker claimed job" })
    .eq("id", nextJob.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (claimError) {
    throw new Error(`Failed to claim queued job ${nextJob.id}: ${claimError.message}`);
  }

  if (claimedJob) {
    lastClaimedJobAt = new Date().toISOString();
    jobLogHistory.set(nextJob.id, `[${new Date().toISOString()}] Worker claimed job`);
  }
  return claimedJob;
}

function logMemory(context: string) {
  const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  const heapUsedMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  console.log(`[mem] ${context} rss=${rssMb}MB heapUsed=${heapUsedMb}MB`);
}

async function runCommand(
  name: string,
  file: string,
  args: string[],
  timeoutMs = 15 * 60 * 1000,
  envOverrides: Record<string, string> = {}
) {
  console.log(`[job] ${name} start`);
  logMemory(`${name} before spawn`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        ...envOverrides
      }
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
      logMemory(`${name} after completion`);
      resolve();
    });
  });
}

async function runCommandCapture(name: string, file: string, args: string[], timeoutMs = 5 * 60 * 1000) {
  console.log(`[job] ${name} start`);
  let stdout = "";
  let stderr = "";

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    const killTimer = setTimeout(() => {
      console.error(`[job] ${name} timed out after ${timeoutMs}ms`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve(code ?? 1);
    });
  });

  if (stderr.trim()) {
    console.log(`[job] ${name} stderr:\n${stderr.trim()}`);
  }
  if (exitCode !== 0) {
    throw new Error(`${name} exited with code ${exitCode}`);
  }
  console.log(`[job] ${name} done`);
  return stdout.trim();
}

async function getDbIdentity(dsn: string, label: string) {
  const raw = await runCommandCapture(`${label} identity`, "psql", [
    dsn,
    "-tAc",
    "select concat_ws('|', current_database(), coalesce(inet_server_addr()::text,'local'), inet_server_port()::text);"
  ]);
  return raw;
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function resolveFinalizeSqlPath() {
  if (process.env.FINALIZE_SQL_PATH) {
    console.log(`[job] Using FINALIZE_SQL_PATH override: ${process.env.FINALIZE_SQL_PATH}`);
    return process.env.FINALIZE_SQL_PATH;
  }

  const moduleDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
  const candidatePaths = [
    "/app/sql/finalize.sql",
    resolve(moduleDir, "../sql/finalize.sql"),
    resolve(moduleDir, "../../sql/finalize.sql"),
    resolve(moduleDir, "../../../sql/finalize.sql"),
    resolve(process.cwd(), "sql/finalize.sql"),
    resolve(process.cwd(), "../sql/finalize.sql"),
    resolve(process.cwd(), "../../sql/finalize.sql")
  ];

  for (const candidate of candidatePaths) {
    try {
      await access(candidate);
      console.log(`[job] Resolved finalize.sql path: ${candidate}`);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Could not find finalize.sql. Tried: ${candidatePaths.join(", ")}.`);
}

async function createSignedDownloadUrl(storagePath: string) {
  const { data: signedData, error: signedUrlError } = await supabase.storage
    .from("gis-uploads")
    .createSignedUrl(storagePath, 60 * 60);
  if (signedUrlError) throw new Error(`Failed to create signed URL for "${storagePath}": ${signedUrlError.message}`);
  if (!signedData?.signedUrl) throw new Error(`Failed to create signed URL for source file "${storagePath}"`);
  return signedData.signedUrl;
}

async function downloadViaSupabaseAdmin(storagePath: string, localPath: string) {
  const { data, error } = await supabase.storage.from("gis-uploads").download(storagePath);
  if (error) {
    throw new Error(`Supabase admin download failed for "${storagePath}": ${error.message}`);
  }
  if (!data) {
    throw new Error(`Supabase admin download returned no data for "${storagePath}"`);
  }

  const sourceFile = createWriteStream(localPath, { flags: "w" });
  await pipeline(Readable.fromWeb(data.stream() as any), sourceFile);
}

async function downloadToFileWithRetry(
  getSignedUrl: () => Promise<string>,
  localPath: string,
  attempts = 3
) {
  let lastError: unknown = null;
  const timeoutMs = 10 * 60 * 1000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let timeout: NodeJS.Timeout | null = null;
    try {
      const signedUrl = await getSignedUrl();
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), timeoutMs);

      const downloadResponse = await fetch(signedUrl, { signal: controller.signal });
      if (!downloadResponse.ok) {
        throw new Error(`Storage download failed: HTTP ${downloadResponse.status}`);
      }
      if (!downloadResponse.body) {
        throw new Error("Storage download failed: missing response stream");
      }

      const sourceFile = createWriteStream(localPath, { flags: "w" });
      await pipeline(Readable.fromWeb(downloadResponse.body as any), sourceFile);
      console.log(`[job] Download succeeded on attempt ${attempt}/${attempts}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const backoffMs = attempt * 1000;
      console.warn(`Download attempt ${attempt}/${attempts} failed, retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw new Error(
    `Storage download failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

async function processJob(job: any) {
  await updateJob(job.id, "processing", "Downloading upload from storage");
  console.log(`[job ${job.id}] starting with storage_path="${job.storage_path}" filename="${job.original_filename}"`);

  const postgresJobExistsRaw = await runCommandCapture("postgres job existence check", "psql", [
    postgresDsn,
    "-tAc",
    `select count(*) from public.gis_processing_jobs where id = ${Number(job.id)};`
  ]);
  const postgresJobExists = Number.parseInt(postgresJobExistsRaw, 10);
  if (!Number.isFinite(postgresJobExists) || postgresJobExists <= 0) {
    throw new Error(
      `Job ${job.id} exists in Supabase queue but not in POSTGRES_DSN database. Check DB env alignment between Supabase and worker Postgres DSNs.`
    );
  }

  const ogrIdentity = await getDbIdentity(dbUrl, "POSTGRES_OGR_DSN");
  const psqlIdentity = await getDbIdentity(postgresDsn, "POSTGRES_DSN");
  if (ogrIdentity !== psqlIdentity) {
    throw new Error(
      `POSTGRES_OGR_DSN and POSTGRES_DSN target different databases (ogr=${ogrIdentity}, psql=${psqlIdentity}).`
    );
  }

  await mkdir("/tmp/gml", { recursive: true });
  const sourceExt = extname(job.original_filename ?? "").toLowerCase();
  const localExt = sourceExt === ".zip" ? ".zip" : ".gml";
  const localPath = `/tmp/gml/${job.id}${localExt}`;

  try {
    await updateJob(job.id, "processing", "Downloading source file to worker disk");
    try {
      await downloadViaSupabaseAdmin(job.storage_path, localPath);
      console.log(`[job ${job.id}] Downloaded via Supabase admin storage API`);
    } catch (adminDownloadError) {
      console.warn(`[job ${job.id}] Admin storage download failed, falling back to signed URL:`, adminDownloadError);
      await downloadToFileWithRetry(() => createSignedDownloadUrl(job.storage_path), localPath, 3);
    }

    await updateJob(job.id, "processing", "Downloaded upload, importing with ogr2ogr");
    await runCommand("ogrinfo preflight", "ogrinfo", ["-ro", "-so", localPath], 5 * 60 * 1000);

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
        "-gt",
        "2000",
        "--config",
        "PG_USE_COPY",
        "YES",
        "--config",
        "CPL_TMPDIR",
        "/tmp",
        "--config",
        "VSI_CACHE",
        "FALSE",
        "-t_srs",
        "EPSG:4326",
        "-overwrite"
      ],
      30 * 60 * 1000,
      {
        OGR_WFS_PAGING_ALLOWED: "YES",
        OGR_SQLITE_CACHE: "0",
        GDAL_CACHEMAX: "64"
      }
    );

    const stagedRowCountRaw = await runCommandCapture("staging row count", "psql", [
      postgresDsn,
      "-tAc",
      "select count(*) from public.staging_parcels;"
    ]);
    const stagedRowCount = Number.parseInt(stagedRowCountRaw, 10);
    if (!Number.isFinite(stagedRowCount) || stagedRowCount <= 0) {
      throw new Error(`No rows were imported into staging_parcels (count=${stagedRowCountRaw || "unknown"})`);
    }

    const stagedGeomCountRaw = await runCommandCapture("staging non-null geom count", "psql", [
      postgresDsn,
      "-tAc",
      "select count(*) from public.staging_parcels where geom is not null;"
    ]);
    const stagedGeomCount = Number.parseInt(stagedGeomCountRaw, 10);
    if (!Number.isFinite(stagedGeomCount) || stagedGeomCount <= 0) {
      throw new Error(
        `Staging import has no non-null geometries (geom_count=${stagedGeomCountRaw || "unknown"}, total=${stagedRowCount})`
      );
    }

    await updateJob(job.id, "processing", "Running finalize.sql");
    const finalizeSqlPath = await resolveFinalizeSqlPath();
    await updateJob(job.id, "processing", `Running finalize.sql at: ${finalizeSqlPath}`);
    await runCommand("psql finalize", "psql", [postgresDsn, "-f", finalizeSqlPath]);

    const parcelCountRaw = await runCommandCapture("parcel table count", "psql", [
      postgresDsn,
      "-tAc",
      "select count(*) from public.parcels;"
    ]);
    const parcelCount = Number.parseInt(parcelCountRaw, 10);
    if (!Number.isFinite(parcelCount) || parcelCount <= 0) {
      throw new Error(`Finalize completed but parcels is still empty (count=${parcelCountRaw || "unknown"})`);
    }

    await updateJob(job.id, "completed", "Imported and indexed");
  } finally {
    await rm(localPath, { force: true });
  }
}

async function run() {
  console.log("[worker] polling loop started");
  while (true) {
    try {
      const job = await claimNextQueuedJob();

      if (!job) {
        console.log(`[worker] no queued jobs (last poll ${lastPollAt})`);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      console.log(`[worker] claimed job ${job.id}`);

      try {
        await processJob(job);
        lastCompletedJobAt = new Date().toISOString();
        jobLogHistory.delete(Number(job.id));
      } catch (e: any) {
        console.error(`Job ${job.id} failed:`, e?.message ?? e);
        await updateJob(job.id, "failed", e?.message ?? "Unknown worker error");
        jobLogHistory.delete(Number(job.id));
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
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        lastPollAt,
        lastClaimedJobAt,
        lastCompletedJobAt
      })
    );
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
