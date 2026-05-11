import { getSupabaseAdmin } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("gis_processing_jobs")
    .select("id,status,logs,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
