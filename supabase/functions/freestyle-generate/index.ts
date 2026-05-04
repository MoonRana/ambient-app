import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const body = await req.json();
    const { patient_id, documents, recordings, notes, medications } = body;

    // Log what we received for debugging
    console.log(`[freestyle-generate] Received: notes=${notes?.length || 0} chars, meds=${medications?.length || 0}, docs=${documents?.length || 0}, recs=${recordings?.length || 0}`);

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

    // Use service role for background updates (user token may expire)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Kick off background processing
    EdgeRuntime?.waitUntil?.(
      processJobAsync(serviceClient, job.id, body, user.id, authHeader),
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

// ── Background Processing ────────────────────────────────────────────────────

async function processJobAsync(
  supabase: any,
  jobId: string,
  inputs: any,
  userId: string,
  authHeader: string,
) {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  try {
    // Step 1: Gather all clinical content
    await supabase
      .from("freestyle_jobs")
      .update({ status: "extracting", progress: 15, current_step: "Gathering clinical data" })
      .eq("id", jobId);

    const allContent: string[] = [];

    // Notes (typed by user)
    if (inputs.notes?.trim()) {
      allContent.push(`CLINICAL NOTES:\n${inputs.notes.trim()}`);
    }

    // Medications
    if (inputs.medications?.length > 0) {
      const medList = inputs.medications.map((m: any) => {
        let entry = m.medication_name || m.name || '';
        if (m.dosage || m.dose) entry += ` ${m.dosage || m.dose}`;
        if (m.frequency) entry += ` (${m.frequency})`;
        return `  - ${entry}`;
      }).join("\n");
      allContent.push(`CURRENT MEDICATIONS:\n${medList}`);
    }

    // Recording transcripts
    if (inputs.recordings?.length > 0) {
      for (let i = 0; i < inputs.recordings.length; i++) {
        const rec = inputs.recordings[i];
        if (rec.transcript?.trim()) {
          allContent.push(`ENCOUNTER RECORDING ${i + 1} (${rec.duration_s || '?'}s):\n${rec.transcript.trim()}`);
        }
      }
    }

    // Documents — download from storage if they're images
    if (inputs.documents?.length > 0) {
      for (const doc of inputs.documents) {
        if (doc.storage_path) {
          try {
            const { data: urlData } = await supabase.storage
              .from("freestyle-documents")
              .createSignedUrl(doc.storage_path, 600);
            if (urlData?.signedUrl) {
              allContent.push(`UPLOADED DOCUMENT "${doc.name}" (${doc.type}): Available at signed URL`);
            }
          } catch (e: any) {
            console.warn(`Doc access failed: ${e?.message}`);
          }
        }
      }
    }

    console.log(`[freestyle-generate] Assembled ${allContent.length} content sections for job ${jobId}`);

    // Step 2: Build transcript for generate-soap-note
    await supabase
      .from("freestyle_jobs")
      .update({ status: "generating", progress: 40, current_step: "Generating clinical note" })
      .eq("id", jobId);

    const clinicalContext = allContent.length > 0
      ? allContent.join("\n\n---\n\n")
      : "No clinical information provided.";

    // Try to use the existing generate-soap-note edge function first (it's proven to work)
    let resultNote: string | null = null;

    try {
      console.log(`[freestyle-generate] Calling generate-soap-note for job ${jobId}`);
      const soapResponse = await fetch(`${SUPABASE_URL}/functions/v1/generate-soap-note`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: jobId,
          transcript: clinicalContext,
          patient_info: inputs.patient_info || {},
          medications: inputs.medications || [],
          diagnoses: [],
        }),
      });

      if (soapResponse.ok) {
        const soapData = await soapResponse.json();
        resultNote = soapData.full_note || null;
        console.log(`[freestyle-generate] SOAP note generated, length: ${resultNote?.length || 0}`);
      } else {
        const errText = await soapResponse.text();
        console.warn(`[freestyle-generate] SOAP function returned ${soapResponse.status}: ${errText.slice(0, 200)}`);
      }
    } catch (e: any) {
      console.warn(`[freestyle-generate] SOAP function call failed: ${e?.message}`);
    }

    // Fallback: call OpenAI directly if SOAP function didn't work
    if (!resultNote && OPENAI_API_KEY) {
      console.log(`[freestyle-generate] Falling back to direct OpenAI call`);
      await supabase
        .from("freestyle_jobs")
        .update({ progress: 60, current_step: "Generating H&P with AI" })
        .eq("id", jobId);

      resultNote = await generateWithOpenAI(OPENAI_API_KEY, clinicalContext);
    }

    // Final fallback: basic structured note
    if (!resultNote) {
      console.log(`[freestyle-generate] Using basic note generation`);
      resultNote = `CLINICAL DOCUMENTATION\n\n${clinicalContext}\n\n---\nNote: AI generation unavailable. Raw clinical data shown above.`;
    }

    // Step 3: Save result
    await supabase
      .from("freestyle_jobs")
      .update({ status: "finalizing", progress: 90, current_step: "Saving results" })
      .eq("id", jobId);

    await supabase
      .from("freestyle_jobs")
      .update({
        status: "complete",
        progress: 100,
        current_step: null,
        result_note: resultNote,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    console.log(`[freestyle-generate] Job ${jobId} completed successfully`);

  } catch (err: any) {
    console.error(`[freestyle-generate] Job ${jobId} failed:`, err);
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

// ── Direct OpenAI fallback ───────────────────────────────────────────────────

async function generateWithOpenAI(apiKey: string, clinicalContext: string): Promise<string> {
  const systemPrompt = `You are a clinical documentation specialist. Generate a comprehensive History and Physical (H&P) note based on the provided clinical information.

RULES:
- Use standard H&P format with clear section headers
- Include ALL relevant information from the input — do not omit any details
- If information for a section is genuinely not available, skip that section entirely
- Do NOT include sections with "[Not documented]" — only include sections with actual content
- Be thorough but concise
- Use proper medical terminology

Sections to include (only if data exists):
CHIEF COMPLAINT, HISTORY OF PRESENT ILLNESS, PAST MEDICAL HISTORY, MEDICATIONS, ALLERGIES, SOCIAL HISTORY, FAMILY HISTORY, REVIEW OF SYSTEMS, PHYSICAL EXAMINATION, ASSESSMENT & PLAN`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate an H&P note from the following clinical information. Only include sections that have actual data — never put "[Not documented]":\n\n${clinicalContext}` },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error: ${response.status} - ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Error: No content generated";
}
