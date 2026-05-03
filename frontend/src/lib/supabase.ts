import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Copy frontend/.env.example to frontend/.env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

// We intentionally don't pass a Database generic here. Recent Supabase JS releases
// infer Insert types in a way that conflicts with hand-written Database schemas,
// so we model our table rows in `@/types/database.ts` and cast at the call site.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const STORAGE_BUCKET = "documents";
