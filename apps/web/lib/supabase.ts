import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let browserClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

export function getSupabaseBrowser() {
  if (!url || !anonKey) return null;
  if (!browserClient) {
    browserClient = createClient(url, anonKey);
  }
  return browserClient;
}

export function hasSupabaseServerConfig() {
  return Boolean(url && serviceKey);
}

export function getSupabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (!adminClient) {
    adminClient = createClient(url, serviceKey, {
      auth: { persistSession: false }
    });
  }

  return adminClient;
}
