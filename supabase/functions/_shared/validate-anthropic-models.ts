// Startup-time validator for Anthropic model IDs.
//
// Import this module at the top of any edge function that calls the Anthropic
// API. On the first import in an isolate (cold start), it issues a tiny
// validation request for every known model ID and throws if any of them
// return 404 (model not found). The result is cached in a module-level
// promise so subsequent imports / requests in the same isolate are free.
//
// Goal: catch stale / typo'd model IDs (e.g. `claude-3-5-haiku-latest`,
// `claude-sonnet-4-20250514`) at cold start instead of mid-request.

// Canonical list of every Anthropic model ID used by any edge function.
// Keep this in sync with the `model:` fields in supabase/functions/**.
export const REQUIRED_ANTHROPIC_MODELS = [
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
] as const;

export type AnthropicModelId = typeof REQUIRED_ANTHROPIC_MODELS[number];

export interface ModelValidationResult {
  model: string;
  ok: boolean;
  status: number;
  error?: string;
}

async function probeModel(
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<ModelValidationResult> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal,
    });

    if (res.status === 404) {
      const body = await res.text();
      return { model, ok: false, status: 404, error: body.slice(0, 300) };
    }
    // Anything other than 404 (200, 400, 429, 529, etc.) means the model ID
    // is recognized by Anthropic — validation passes. We do NOT fail on
    // transient errors so a rate-limit hiccup can't take down cold start.
    return { model, ok: true, status: res.status };
  } catch (err) {
    // Network errors / aborts: treat as soft-pass so we don't block boot.
    return {
      model,
      ok: true,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let cached: Promise<ModelValidationResult[]> | null = null;

export function validateAnthropicModels(
  models: readonly string[] = REQUIRED_ANTHROPIC_MODELS,
): Promise<ModelValidationResult[]> {
  if (cached) return cached;

  cached = (async () => {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      // No key configured — nothing to validate. Don't throw; let the
      // function surface its own missing-key error at request time.
      console.warn("[validate-anthropic-models] ANTHROPIC_API_KEY not set; skipping validation");
      return models.map((m) => ({ model: m, ok: true, status: 0 }));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const results = await Promise.all(
        models.map((m) => probeModel(apiKey, m, ctrl.signal)),
      );
      const bad = results.filter((r) => !r.ok);
      if (bad.length > 0) {
        const detail = bad
          .map((r) => `${r.model} -> ${r.status} ${r.error ?? ""}`.trim())
          .join("; ");
        // Clear cache so a follow-up deploy (with fixed IDs) can re-validate.
        cached = null;
        throw new Error(
          `Anthropic model validation failed for: ${detail}. ` +
            `Update supabase/functions/_shared/validate-anthropic-models.ts ` +
            `and the offending edge function.`,
        );
      }
      console.log(
        `[validate-anthropic-models] OK (${results.length} models): ` +
          results.map((r) => r.model).join(", "),
      );
      return results;
    } finally {
      clearTimeout(timer);
    }
  })();

  return cached;
}

// Fire-and-log on import so cold start surfaces failures immediately in logs.
// We intentionally do NOT `await` at top level — Deno deploy supports it but
// a failure here would brick every request; instead we log and let the first
// real request trigger a hard failure via `assertAnthropicModelsValid()`.
validateAnthropicModels().catch((err) => {
  console.error("[validate-anthropic-models] startup probe failed:", err);
});

// Call this at the top of every request handler that uses Anthropic.
// Non-blocking AND non-throwing by design (Aug 2026): a failed cold-start probe
// used to throw here, outside the handler's try/catch, producing an opaque 500
// with no JSON body — the client then showed "Edge Function returned a non-2xx
// status code" with no reason. A genuinely bad model id still surfaces cleanly
// from the real Anthropic call, which returns a named reason.
export async function assertAnthropicModelsValid(): Promise<void> {
  if (!cached) return;
  const settled = await Promise.race([
    cached.then(() => "ok" as const).catch((e) => ({ err: e })),
    Promise.resolve("pending" as const),
  ]);
  if (settled && typeof settled === "object" && "err" in settled) {
    console.error("[validate-anthropic-models] probe failed (non-blocking):", settled.err);
  }
}

