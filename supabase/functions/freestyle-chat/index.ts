import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * POST /functions/v1/freestyle-chat
 *
 * Accepts:
 *   - job_id: string
 *   - message: string
 *   - current_note: string
 *
 * Returns:
 *   - { message_id, reply, updated_note, diff[] }
 *
 * Stores messages in freestyle_chat_messages table.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { job_id, message, current_note } = await req.json();

    if (!job_id || !message) {
      return new Response(
        JSON.stringify({ error: "job_id and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify job belongs to user
    const { data: job, error: jobError } = await supabaseClient
      .from("freestyle_jobs")
      .select("id, user_id")
      .eq("id", job_id)
      .single();

    if (jobError || !job || job.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save user message
    await supabaseClient
      .from("freestyle_chat_messages")
      .insert({
        job_id,
        user_id: user.id,
        role: "user",
        content: message,
      });

    // TODO: Call LLM to process the refinement request
    // For now, return a placeholder response
    const reply = `I'll help you with that. Here's my suggested edit based on your request: "${message}"`;
    const diff = generateMockDiff(message, current_note);
    const updatedNote = current_note; // In production, apply the diff

    // Save assistant response
    const { data: assistantMsg, error: msgError } = await supabaseClient
      .from("freestyle_chat_messages")
      .insert({
        job_id,
        user_id: user.id,
        role: "assistant",
        content: reply,
        diff: diff.length > 0 ? diff : null,
      })
      .select("id")
      .single();

    if (msgError) {
      return new Response(JSON.stringify({ error: msgError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        message_id: assistantMsg.id,
        reply,
        updated_note: updatedNote,
        diff,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("freestyle-chat error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Mock diff generator — in production, this would use the LLM output
 */
function generateMockDiff(message: string, currentNote: string) {
  // Simple heuristic: if user mentions a section, generate a diff for it
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("hpi") || lowerMsg.includes("history")) {
    return [{
      section: "History of Present Illness",
      before: "Patient presents for evaluation.",
      after: "Patient presents for comprehensive evaluation per clinical request.",
    }];
  }

  if (lowerMsg.includes("plan") || lowerMsg.includes("assessment")) {
    return [{
      section: "Assessment & Plan",
      before: "Clinical assessment based on provided documentation.",
      after: "Clinical assessment with updated treatment plan per provider discussion.",
    }];
  }

  return [];
}
