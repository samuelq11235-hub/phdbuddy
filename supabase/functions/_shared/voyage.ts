const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-3-lite";

export type VoyageInputType = "document" | "query";

export interface VoyageEmbedOptions {
  model?: string;
  inputType?: VoyageInputType;
  /** How many times to retry on 429 / 5xx. Defaults to 8. */
  maxRetries?: number;
}

export interface VoyageEmbedResponse {
  embeddings: number[][];
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * Thrown when Voyage keeps returning HTTP 429 even after all retries.
 * Callers can catch this to surface a user-friendly "add payment method
 * or wait a minute" message instead of a generic 500.
 */
export class VoyageRateLimitError extends Error {
  readonly status = 429;
  readonly body: string;
  constructor(body: string) {
    super(`Voyage rate limit (429) after retries: ${body}`);
    this.name = "VoyageRateLimitError";
    this.body = body;
  }
}

/**
 * Call Voyage's embeddings endpoint with built-in retry/backoff for
 * rate limits (HTTP 429) and transient 5xx errors. Honors the
 * `Retry-After` header when present, otherwise waits at least ~21s
 * on 429 (Voyage's free tier uses a 60s window for 3 RPM).
 */
export async function embedTexts(
  inputs: string[],
  options: VoyageEmbedOptions = {}
): Promise<VoyageEmbedResponse> {
  const apiKey = Deno.env.get("VOYAGE_API_KEY");
  if (!apiKey) {
    throw new Error("Missing VOYAGE_API_KEY environment variable");
  }

  if (inputs.length === 0) {
    return { embeddings: [], model: options.model ?? DEFAULT_MODEL, usage: { total_tokens: 0 } };
  }

  const maxRetries = options.maxRetries ?? 8;
  let attempt = 0;
  let lastErrorBody = "";
  let lastStatus = 0;

  while (true) {
    let res: Response;
    try {
      res = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: inputs,
          model: options.model ?? DEFAULT_MODEL,
          input_type: options.inputType ?? "document",
        }),
      });
    } catch (networkErr) {
      // Treat network errors as retryable transient failures.
      if (attempt >= maxRetries) throw networkErr;
      const waitMs = Math.min(2000 * Math.pow(2, attempt), 30_000);
      console.warn(
        `[voyage] network error (attempt ${attempt + 1}/${maxRetries}), waiting ${waitMs}ms`,
        networkErr
      );
      await new Promise((r) => setTimeout(r, waitMs));
      attempt += 1;
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      return {
        embeddings: data.data.map((d: { embedding: number[] }) => d.embedding),
        model: data.model,
        usage: data.usage,
      };
    }

    lastErrorBody = await res.text();
    lastStatus = res.status;

    const isRateLimit = res.status === 429;
    const retryable = isRateLimit || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt >= maxRetries) {
      if (isRateLimit) throw new VoyageRateLimitError(lastErrorBody);
      throw new Error(`Voyage API error ${res.status}: ${lastErrorBody}`);
    }

    const retryAfterSec = Number(res.headers.get("retry-after"));
    const expBackoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s, 16s, 32s, 64s, 65s
    let baseMs: number;
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
      baseMs = retryAfterSec * 1000;
    } else if (isRateLimit) {
      // Voyage free tier resets every ~60s. Wait at least ~21s on 429
      // so we don't burn retries against the same 60s window.
      baseMs = Math.max(expBackoffMs, 21_000);
    } else {
      baseMs = expBackoffMs;
    }

    const jitterMs = Math.floor(Math.random() * 500);
    const waitMs = Math.min(baseMs + jitterMs, 65_000);

    console.warn(
      `[voyage] ${res.status} (attempt ${attempt + 1}/${maxRetries}), waiting ${waitMs}ms`
    );
    await new Promise((r) => setTimeout(r, waitMs));
    attempt += 1;
  }
}

export async function embedQuery(text: string, model?: string): Promise<number[]> {
  const result = await embedTexts([text], {
    model,
    inputType: "query",
  });
  return result.embeddings[0];
}
