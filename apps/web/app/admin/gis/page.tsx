"use client";

import { useState } from "react";

export default function AdminGisPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setStatus("uploading");
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
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
        <p className="mt-2 text-sm text-zinc-300">Status: {status}</p>
        {error ? <p className="mt-1 text-sm text-red-400">Error: {error}</p> : null}
      </div>
      <JobTable />
    </main>
  );
}

function JobTable() {
  const [jobs, setJobs] = useState<any[]>([]);

  async function refresh() {
    const res = await fetch("/api/jobs");
    setJobs(await res.json());
  }

  return (
    <section className="space-y-2">
      <button onClick={refresh} className="rounded border border-zinc-700 px-3 py-2">Refresh Queue</button>
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
