/**
 * stat-consult-api — Supabase Edge Function
 *
 * A public-facing proxy for the internal `clinical-qa` edge function.
 * Third-party apps authenticate with `X-API-Key` header and never need
 * Supabase credentials.
 *
 * Routes:
 *   GET  /stat-consult-api/specialties  → list active specialties
 *   POST /stat-consult-api              → stream clinical Q&A (SSE)
 *
 * Deploy:
 *   supabase functions deploy stat-consult-api --no-verify-jwt
 *
 * Set secret:
 *   supabase secrets set STAT_CONSULT_API_KEY=your-strong-secret
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Helpers ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API_KEY = Deno.env.get("STAT_CONSULT_API_KEY") ?? "";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, X-API-Key, Authorization",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
}

function authError() {
    return json(
        { error: "Unauthorized. Pass your API key in the X-API-Key header." },
        401,
    );
}

function validateApiKey(req: Request): boolean {
    const key = req.headers.get("X-API-Key") ?? "";
    if (!API_KEY) {
        // Secret not configured — deny all
        console.error("[stat-consult-api] STAT_CONSULT_API_KEY is not set.");
        return false;
    }
    return key === API_KEY;
}

// ── Specialties ───────────────────────────────────────────────────────────────

async function handleSpecialties(): Promise<Response> {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
        .from("specialties")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

    if (error) {
        return json({ error: error.message }, 500);
    }
    return json(data ?? []);
}

// ── Clinical Q&A Streaming Proxy ─────────────────────────────────────────────

async function handleAsk(req: Request): Promise<Response> {
    let body: {
        question?: string;
        specialty_id?: string | null;
        conversation_history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    try {
        body = await req.json();
    } catch {
        return json({ error: "Invalid JSON body." }, 400);
    }

    const { question, specialty_id = null, conversation_history = [] } = body;

    if (!question || typeof question !== "string" || !question.trim()) {
        return json({ error: "`question` is required and must be a non-empty string." }, 400);
    }

    // Call the internal clinical-qa function using the service-role key
    // so the external caller never needs Supabase credentials.
    const internalUrl = `${SUPABASE_URL}/functions/v1/clinical-qa`;

    const upstream = await fetch(internalUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Accept": "text/event-stream",
        },
        body: JSON.stringify({
            question: question.trim(),
            specialty_id,
            stream: true,
            conversation_history,
        }),
    });

    if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => "Unknown error");
        console.error("[stat-consult-api] upstream error:", upstream.status, errText);
        return json(
            { error: `Upstream error: ${upstream.status}. ${errText.slice(0, 200)}` },
            502,
        );
    }

    // Pipe the SSE stream straight through to the caller
    return new Response(upstream.body, {
        status: 200,
        headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no", // Disable nginx buffering
        },
    });
}

// ── Router ────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
    const url = new URL(req.url);

    // Always allow CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Authenticate every real request
    if (!validateApiKey(req)) {
        return authError();
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    const lastSegment = pathParts[pathParts.length - 1];

    // GET .../specialties
    if (req.method === "GET" && lastSegment === "specialties") {
        return handleSpecialties();
    }

    // POST .../stat-consult-api  (or with trailing slash)
    if (req.method === "POST") {
        return handleAsk(req);
    }

    return json({ error: "Not found." }, 404);
});
