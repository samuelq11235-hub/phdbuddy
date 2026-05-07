// Output-level cache for expensive Claude calls. The pattern is:
//
//   const { value, cached } = await getOrSetAiCache(client, {
//     projectId, kind: "devils_advocate",
//     input: { claim, source }, // hashed
//     ttlSeconds: 60 * 60 * 24,
//     compute: () => actuallyCallClaude(),
//   });
//
// We hash the inputs with SHA-256 and JSON-canonicalise them so two
// payloads that differ only in key order share the same cache row.
// Hits are counted and `last_hit_at` is bumped so the dashboard can
// surface popular prompts. Misses recompute and upsert.
//
// The cache deliberately lives in `ai_cache`, not in the edge function
// memory: edge functions are ephemeral and most caches across them
// would never warm up.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

interface CacheArgs<T> {
  projectId: string;
  kind: string;
  input: unknown;
  ttlSeconds?: number;
  compute: () => Promise<T>;
}

interface CacheResult<T> {
  value: T;
  cached: boolean;
  ageMs: number;
}

const ENCODER = new TextEncoder();

export async function hashInput(input: unknown): Promise<string> {
  const canon = canonicalJson(input);
  const buf = await crypto.subtle.digest("SHA-256", ENCODER.encode(canon));
  return bufToHex(buf);
}

export async function getOrSetAiCache<T>(
  client: SupabaseClient,
  args: CacheArgs<T>
): Promise<CacheResult<T>> {
  const inputHash = await hashInput(args.input);

  // Look up. We use maybeSingle so the absence is a clean null.
  const { data: existing } = await client
    .from("ai_cache")
    .select("output, created_at, hit_count")
    .eq("project_id", args.projectId)
    .eq("kind", args.kind)
    .eq("input_hash", inputHash)
    .maybeSingle();

  if (existing) {
    const createdAt = new Date(existing.created_at as string).getTime();
    const ageMs = Date.now() - createdAt;
    const ttlMs = (args.ttlSeconds ?? 60 * 60 * 24) * 1000;
    if (ageMs < ttlMs) {
      // Bump hit counter without blocking the response — fire & forget.
      // Edge runtime keeps the promise alive long enough.
      client
        .from("ai_cache")
        .update({
          hit_count: ((existing.hit_count as number) ?? 0) + 1,
          last_hit_at: new Date().toISOString(),
        })
        .eq("project_id", args.projectId)
        .eq("kind", args.kind)
        .eq("input_hash", inputHash)
        .then(() => {}, () => {});
      return {
        value: existing.output as T,
        cached: true,
        ageMs,
      };
    }
  }

  const value = await args.compute();

  // Upsert so repeated misses don't error on the unique constraint.
  await client
    .from("ai_cache")
    .upsert(
      {
        project_id: args.projectId,
        kind: args.kind,
        input_hash: inputHash,
        output: value as unknown as Record<string, unknown>,
        hit_count: 0,
      },
      { onConflict: "project_id,kind,input_hash" }
    );

  return { value, cached: false, ageMs: 0 };
}

/** Stable JSON: sort keys recursively so identical inputs hash identically. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
