import { getSupabaseAdmin, hasSupabaseServerConfig } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  if (!hasSupabaseServerConfig()) {
    return NextResponse.json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL." }, { status: 500 });
  }

  const { error } = await getSupabaseAdmin().from("gis_processing_jobs").select("id", { count: "exact", head: true });
  if (error) {
    return NextResponse.json({ ok: false, error: `Supabase query failed: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
