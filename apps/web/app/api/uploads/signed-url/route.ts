import { getSupabaseAdmin } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const filename = typeof body?.filename === "string" ? body.filename : "";
  if (!filename) {
    return NextResponse.json({ error: "Missing filename" }, { status: 400 });
  }

  const lowerName = filename.toLowerCase();
  const isGml = lowerName.endsWith(".gml");
  const isZip = lowerName.endsWith(".zip");
  if (!isGml && !isZip) {
    return NextResponse.json({ error: "Unsupported file type. Please upload .gml or .zip." }, { status: 400 });
  }

  const objectPath = `gml/${Date.now()}-${filename}`;
  const { data, error } = await getSupabaseAdmin().storage
    .from("gis-uploads")
    .createSignedUploadUrl(objectPath);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ token: data.token, storagePath: objectPath });
}
