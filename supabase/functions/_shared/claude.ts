const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

// Retries automatically respect the `retry-after` header (in seconds) when
// the API returns a 429 (rate limit) or 529 (overloaded) response. Capped
// so a stuck job can't sit in an edge function for an hour.
const MAX_RETRIES = 4;
const MAX_RETRY_WAIT_MS = 75_000;

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeOptions {
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Thrown when a request can't be retried any further. Allows callers
 *  (e.g. ai-auto-code) to react differently to rate-limit errors than
 *  to schema/auth errors without parsing string messages. */
export class ClaudeRateLimitError extends Error {
  constructor(message: string, public readonly retryAfterMs: number | null) {
    super(message);
    this.name = "ClaudeRateLimitError";
  }
}

async function fetchClaudeWithRetry(
  body: Record<string, unknown>,
  apiKey: string,
  attempt = 0
): Promise<Response> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  // Retry on rate-limit (429) and overload (529). Anthropic sets
  // retry-after when it knows when to come back; otherwise back off
  // exponentially with jitter.
  const isRetryable = res.status === 429 || res.status === 529;
  if (!isRetryable || attempt >= MAX_RETRIES) return res;

  const retryAfterHeader = res.headers.get("retry-after");
  let waitMs = retryAfterHeader ? Math.ceil(Number(retryAfterHeader) * 1000) : NaN;
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    waitMs = Math.min(60_000, 2_000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
  }
  waitMs = Math.min(waitMs, MAX_RETRY_WAIT_MS);

  console.warn(
    `[claude] ${res.status} rate-limited, retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`
  );
  await new Promise((r) => setTimeout(r, waitMs));
  return fetchClaudeWithRetry(body, apiKey, attempt + 1);
}

export interface ClaudeResponse {
  text: string;
  model: string;
  stopReason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export async function callClaude(
  messages: ClaudeMessage[],
  options: ClaudeOptions = {}
): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  const body = {
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
    system: options.system,
    messages,
  };

  const res = await fetchClaudeWithRetry(body, apiKey);

  if (!res.ok) {
    const text = await res.text();
    throw rateLimitOrGenericError(res.status, text);
  }

  const data = await res.json();
  const textBlock = data.content?.find((c: { type: string }) => c.type === "text");
  return {
    text: textBlock?.text ?? "",
    model: data.model,
    stopReason: data.stop_reason ?? "unknown",
    usage: data.usage,
  };
}

function rateLimitOrGenericError(status: number, body: string): Error {
  if (status === 429 || status === 529) {
    // Anthropic embeds the rate limit details in the JSON body. Surface
    // them to the caller so the UI can render a friendly message.
    let retryAfterMs: number | null = null;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      const ms = /try again in\s+(\d+)\s*ms/i.exec(parsed?.error?.message ?? "");
      const sec = /try again in\s+(\d+)\s*s/i.exec(parsed?.error?.message ?? "");
      if (ms) retryAfterMs = parseInt(ms[1], 10);
      else if (sec) retryAfterMs = parseInt(sec[1], 10) * 1000;
    } catch {
      /* ignore */
    }
    const friendly =
      status === 429
        ? "Tu organización en Anthropic alcanzó el límite de tokens por minuto. Espera un minuto y vuelve a intentarlo, o sube tu plan."
        : "El servicio de Anthropic está saturado en este momento. Reintentalo en unos segundos.";
    return new ClaudeRateLimitError(`${friendly} (${status})`, retryAfterMs);
  }
  return new Error(`Anthropic API error ${status}: ${body}`);
}

/**
 * JSON Schema fragment used to constrain a Claude tool input.
 * Keep it loose — Anthropic only validates `type` and `required` strictly.
 */
export type JsonSchema = Record<string, unknown>;

export interface ClaudeToolOptions extends ClaudeOptions {
  toolName: string;
  toolDescription: string;
  inputSchema: JsonSchema;
}

export interface ClaudeToolResponse<T> {
  data: T;
  model: string;
  stopReason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Calls Claude with a single forced tool. The model is REQUIRED to
 * respond by calling the tool with arguments that conform to the
 * provided JSON schema. This is the canonical way to get reliable
 * structured output from Claude — no regex JSON extraction, no markdown
 * fences, no truncation surprises (Anthropic stops generating once the
 * tool call is well-formed).
 */
export async function callClaudeTool<T>(
  messages: ClaudeMessage[],
  options: ClaudeToolOptions
): Promise<ClaudeToolResponse<T>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  const body = {
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.2,
    system: options.system,
    messages,
    tools: [
      {
        name: options.toolName,
        description: options.toolDescription,
        input_schema: options.inputSchema,
      },
    ],
    tool_choice: { type: "tool", name: options.toolName },
  };

  const startedAt = Date.now();
  const res = await fetchClaudeWithRetry(body, apiKey);

  if (!res.ok) {
    const text = await res.text();
    throw rateLimitOrGenericError(res.status, text);
  }

  const data = await res.json();
  const toolBlock = data.content?.find(
    (c: { type: string; name?: string }) =>
      c.type === "tool_use" && c.name === options.toolName
  );

  console.log(
    `[claude-tool] ${data.model} ${Date.now() - startedAt}ms ` +
      `stop=${data.stop_reason} ` +
      `in=${data.usage?.input_tokens} out=${data.usage?.output_tokens}`
  );

  if (!toolBlock || typeof toolBlock !== "object" || !("input" in toolBlock)) {
    const preview = JSON.stringify(data.content).slice(0, 600);
    throw new Error(
      `Claude did not call tool ${options.toolName}. Stop=${data.stop_reason}. Content: ${preview}`
    );
  }

  return {
    data: (toolBlock as { input: T }).input,
    model: data.model,
    stopReason: data.stop_reason ?? "unknown",
    usage: data.usage,
  };
}

/**
 * Ask Claude for a strict JSON response. Robustly extracts JSON even
 * when Claude wraps it in markdown fences or adds prose around it.
 */
export async function callClaudeJson<T>(
  messages: ClaudeMessage[],
  options: ClaudeOptions = {}
): Promise<{ data: T; raw: ClaudeResponse }> {
  const startedAt = Date.now();
  const response = await callClaude(messages, {
    ...options,
    temperature: options.temperature ?? 0.1,
  });
  console.log(
    `[claude] ${response.model} responded in ${Date.now() - startedAt}ms ` +
      `(in=${response.usage.input_tokens}, out=${response.usage.output_tokens}) ` +
      `text_chars=${response.text.length}`
  );

  const data = extractJson<T>(response.text);
  if (data === null) {
    const preview = response.text.slice(0, 600);
    console.error("[claude] failed to parse JSON. Preview:", preview);
    throw new Error(
      `Claude did not return valid JSON. First 600 chars: ${preview}`
    );
  }

  return { data, raw: response };
}

/**
 * Extracts a JSON object from a string. Handles:
 *   - bare JSON
 *   - ```json ... ``` and ``` ... ``` fenced blocks (anywhere in the text)
 *   - prose before/after the object
 *   - JSON that was truncated mid-output (closes dangling strings,
 *     arrays and objects so we still recover most of the payload)
 * Returns null if nothing parseable can be salvaged.
 */
function extractJson<T>(text: string): T | null {
  const candidates: string[] = [];

  const fenced = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const m of fenced) candidates.push(m[1].trim());

  candidates.push(text.trim());

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  // Last resort: take everything from the first opening brace and try
  // to repair a truncated tail (Claude hit max_tokens mid-payload).
  if (firstBrace !== -1) {
    candidates.push(text.slice(firstBrace));
  }

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // fall through to next candidate
    }
    const repaired = repairTruncatedJson(c);
    if (repaired) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        /* keep trying */
      }
    }
  }
  return null;
}

/**
 * Best-effort repair of JSON that was truncated mid-emission. Tracks
 * brace/bracket nesting and string state, then closes whatever was
 * left open. Drops a trailing partial item if it ends mid-key.
 */
function repairTruncatedJson(input: string): string | null {
  if (!input || input[0] !== "{") return null;

  const stack: string[] = []; // '{' or '['
  let inString = false;
  let escaped = false;
  let lastSafeIdx = -1; // index just past the last completed value

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      if (!inString) lastSafeIdx = i + 1;
      continue;
    }
    if (inString) continue;

    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      lastSafeIdx = i + 1;
    } else if (ch === "," || ch === "}" || ch === "]") {
      lastSafeIdx = i + 1;
    } else if (ch === ":" || /\s/.test(ch)) {
      /* keep going */
    } else {
      // primitive char (digit, letter for true/false/null) — safe-ish
      lastSafeIdx = i + 1;
    }
  }

  // If we ended inside a string, drop back to the last safe point so
  // we don't try to close a half-written value (which would be junk).
  let body = inString && lastSafeIdx > 0 ? input.slice(0, lastSafeIdx) : input;

  // Trim trailing comma / partial key like `"name": "foo,` artifacts.
  body = body.replace(/,\s*$/, "");
  body = body.replace(/:\s*$/, "");
  body = body.replace(/"[^"]*$/, ""); // unterminated key
  body = body.replace(/,\s*$/, "");

  // Recompute stack against the trimmed body so we close the right things.
  const stack2: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") stack2.push(ch);
    else if (ch === "}") {
      if (stack2[stack2.length - 1] === "{") stack2.pop();
    } else if (ch === "]") {
      if (stack2[stack2.length - 1] === "[") stack2.pop();
    }
  }

  if (inStr) body += '"';
  while (stack2.length) {
    const top = stack2.pop();
    body += top === "{" ? "}" : "]";
  }
  return body;
}

export const CLAUDE_MODEL = DEFAULT_MODEL;
