import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * POST /functions/v1/freestyle-generate
 *
 * Accepts:
 *   - patient_id?: string
 *   - documents: { storage_path, type, name }[]
 *   - recordings: { storage_path, transcript?, duration_s }[]
 *   - notes: string
 *   - medications: { medication_name, dosage?, frequency? }[]
 *
 * Returns:
 *   - { job_id: string, status: "queued" }
 *
 * The actual generation happens asynchronously:
 *   1. Extract text/OCR from documents
 *   2. Transcribe audio recordings
 *   3. Concatenate all inputs into a unified clinical context
 *   4. Generate H&P note via LLM
 *   5. Update freestyle_jobs row with result
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
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

    const body = await req.json();
    const { patient_id, documents, recordings, notes, medications } = body;

    // Create the job row
    const { data: job, error: insertError } = await supabaseClient
      .from("freestyle_jobs")
      .insert({
        user_id: user.id,
        patient_id: patient_id || null,
        status: "queued",
        progress: 0,
        current_step: "Waiting in queue",
        inputs: {
          document_count: documents?.length || 0,
          recording_count: recordings?.length || 0,
          has_notes: !!notes?.trim(),
          medication_count: medications?.length || 0,
          documents,
          recordings,
          notes,
          medications,
        },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Job insert failed:", insertError);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TODO: Trigger async worker chain (Inngest / pg_cron / background task)
    // For now, we return the job_id immediately.
    // The worker chain would:
    //   1. Update status → "extracting" (OCR + audio transcription)
    //   2. Update status → "retrieving" (RAG retrieval)
    //   3. Update status → "generating" (LLM H&P generation)
    //   4. Update status → "finalizing" (save result)
    //   5. Update status → "complete" with result_note

    // Simulate: kick off background processing after response
    // In production, this would be an async job queue invocation
    EdgeRuntime?.waitUntil?.(
      processJobAsync(supabaseClient, job.id, body, user.id),
    );

    return new Response(
      JSON.stringify({ job_id: job.id, status: "queued" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("freestyle-generate error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

/**
 * Background processing — runs after the response is sent.
 * In production, replace with Inngest or a proper job queue.
 */
async function processJobAsync(
  supabase: any,
  jobId: string,
  inputs: any,
  userId: string,
) {
  try {
    // Step 1: Extracting
    await supabase
      .from("freestyle_jobs")
      .update({ status: "extracting", progress: 15, current_step: "Extracting document text" })
      .eq("id", jobId);

    // TODO: OCR documents, transcribe audio
    await delay(2000);

    // Step 2: Retrieving
    await supabase
      .from("freestyle_jobs")
      .update({ status: "retrieving", progress: 40, current_step: "Retrieving clinical guidelines" })
      .eq("id", jobId);

    await delay(1500);

    // Step 3: Generating
    await supabase
      .from("freestyle_jobs")
      .update({ status: "generating", progress: 65, current_step: "Generating H&P note" })
      .eq("id", jobId);

    // TODO: Call LLM to generate H&P note
    await delay(3000);

    // Step 4: Finalizing
    await supabase
      .from("freestyle_jobs")
      .update({ status: "finalizing", progress: 90, current_step: "Saving results" })
      .eq("id", jobId);

    await delay(1000);

    // Step 5: Complete
    const placeholderNote = generatePlaceholderNote(inputs);
    await supabase
      .from("freestyle_jobs")
      .update({
        status: "complete",
        progress: 100,
        current_step: null,
        result_note: placeholderNote,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

  } catch (err: any) {
    console.error("Background processing failed:", err);
    await supabase
      .from("freestyle_jobs")
      .update({
        status: "failed",
        error: err.message || "Processing failed",
        current_step: null,
      })
      .eq("id", jobId);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generatePlaceholderNote(inputs: any): string {
  return [
    "HISTORY OF PRESENT ILLNESS:",
    `Patient presents for evaluation. ${inputs.notes || "No additional notes provided."}`,
    "",
    "REVIEW OF SYSTEMS:",
    "Constitutional: No fever, fatigue, or weight changes.",
    "General review otherwise non-contributory.",
    "",
    "PHYSICAL EXAMINATION:",
    "General: Patient appears well-developed, well-nourished, in no acute distress.",
    "Vital signs within normal limits.",
    "",
    "ASSESSMENT & PLAN:",
    "Clinical assessment based on provided documentation and encounter data.",
    `${inputs.medications?.length > 0 ? `Current medications: ${inputs.medications.map((m: any) => m.medication_name).join(", ")}` : "No current medications documented."}`,
    "",
    "FOLLOW-UP:",
    "Follow up as clinically indicated.",
  ].join("\n");
}
