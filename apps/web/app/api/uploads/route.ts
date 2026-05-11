import { supabaseAdmin } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const objectPath = `gml/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from("gis-uploads")
    .upload(objectPath, file, { upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data, error } = await supabaseAdmin.from("gis_processing_jobs").insert({
    storage_path: objectPath,
    original_filename: file.name,
    status: "queued"
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobId: data.id, status: "queued" });
}
