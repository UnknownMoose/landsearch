"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export default function AdminGisPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"unknown" | "checking" | "ok" | "error">("unknown");


  async function checkSupabaseConnection() {
    setConnectionStatus("checking");
    const res = await fetch("/api/health/supabase", { cache: "no-store" });
    if (res.ok) {
      setConnectionStatus("ok");
      return;
    }

    setConnectionStatus("error");
    let message = "Supabase health check failed";
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {}
    setError(message);
  }

  async function upload() {
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus("error");
      setError("File is too large for the current upload flow. Please use a file smaller than 500MB (or upload as split chunks).")
      return;
    }

    const supabaseBrowser = getSupabaseBrowser();
    if (!supabaseBrowser) {
      setStatus("error");
      setError("Missing NEXT_PUBLIC_SUPABASE_URL and a public key (NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");
      return;
    }

    setStatus("uploading");
    setError(null);
    const signedRes = await fetch("/api/uploads/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name })
    });

    if (!signedRes.ok) {
      setStatus("error");
      const payload = await signedRes.json().catch(() => ({}));
      setError(payload?.error ?? "Could not create signed upload URL");
      return;
    }

    const { token, storagePath } = await signedRes.json();

    const { error: storageError } = await supabaseBrowser.storage
      .from("gis-uploads")
      .uploadToSignedUrl(storagePath, token, file);

    if (storageError) {
      setStatus("error");
      setError(`Storage upload failed: ${storageError.message}`);
      return;
    }

    const res = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath, originalFilename: file.name })
    });
    if (res.ok) {
      setStatus("queued");
      return;
    }

    let message = "Upload failed";
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {
      // no-op; keep fallback message
    }

    setStatus("error");
    setError(message);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">GIS Dataset Admin</h1>
      <div className="rounded border border-zinc-700 p-6">
        <input type="file" accept=".gml,.zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button onClick={upload} className="ml-3 rounded bg-emerald-600 px-3 py-2">Upload & Queue</button>
        <button onClick={checkSupabaseConnection} className="ml-3 rounded border border-zinc-700 px-3 py-2">Check Supabase Connection</button>
        <p className="mt-2 text-xs text-zinc-400">Max upload size: 500MB.</p>
        <p className="mt-2 text-sm text-zinc-300">Status: {status}</p>
        <p className="mt-1 text-sm text-zinc-300">Supabase: {connectionStatus}</p>
        {error ? <p className="mt-1 text-sm text-red-400">Error: {error}</p> : null}
      </div>
      <JobTable />
    </main>
  );
}

function JobTable() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/jobs", { cache: "no-store" });
    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      setJobs([]);
      setError(payload?.error ?? "Failed to load job queue");
      setLoading(false);
      return;
    }

    if (Array.isArray(payload)) {
      setJobs(payload);
      setLoading(false);
      return;
    }

    setJobs([]);
    setError("Unexpected queue response format");
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="space-y-2">
      <button onClick={refresh} className="rounded border border-zinc-700 px-3 py-2">{loading ? "Refreshing..." : "Refresh Queue"}</button>
      {error ? <p className="text-sm text-red-400">Queue error: {error}</p> : null}
      {!error && jobs.length === 0 ? <p className="text-sm text-zinc-400">No queue jobs yet.</p> : null}
      <table className="w-full text-left text-sm">
        <thead><tr><th>ID</th><th>Status</th><th>Logs</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}><td>{j.id}</td><td>{j.status}</td><td className="max-w-lg truncate">{j.logs}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
