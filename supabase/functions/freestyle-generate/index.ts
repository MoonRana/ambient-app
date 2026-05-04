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
 * The actual generation happens asynchronously via OpenAI.
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

    // Use service role for background updates (user token may expire)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Kick off background processing
    EdgeRuntime?.waitUntil?.(
      processJobAsync(serviceClient, job.id, body, user.id),
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
) {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

  try {
    // Step 1: Extract content from all inputs
    await supabase
      .from("freestyle_jobs")
      .update({ status: "extracting", progress: 15, current_step: "Extracting document text" })
      .eq("id", jobId);

    const allContent: string[] = [];

    // Gather notes
    if (inputs.notes?.trim()) {
      allContent.push(`CLINICAL NOTES:\n${inputs.notes.trim()}`);
    }

    // Gather medications
    if (inputs.medications?.length > 0) {
      const medList = inputs.medications.map((m: any) => {
        let entry = m.medication_name;
        if (m.dosage) entry += ` ${m.dosage}`;
        if (m.frequency) entry += ` (${m.frequency})`;
        return `  - ${entry}`;
      }).join("\n");
      allContent.push(`CURRENT MEDICATIONS:\n${medList}`);
    }

    // Gather recording transcripts
    if (inputs.recordings?.length > 0) {
      for (let i = 0; i < inputs.recordings.length; i++) {
        const rec = inputs.recordings[i];
        if (rec.transcript?.trim()) {
          allContent.push(`AUDIO RECORDING ${i + 1} TRANSCRIPT (${rec.duration_s || '?'}s):\n${rec.transcript.trim()}`);
        }
      }
    }

    // Gather document content (download and extract text from storage)
    if (inputs.documents?.length > 0) {
      for (let i = 0; i < inputs.documents.length; i++) {
        const doc = inputs.documents[i];
        if (doc.storage_path) {
          try {
            // For images, we'll pass the URL to OpenAI Vision
            // For PDFs, we'll note it as a reference
            if (doc.type === 'image') {
              const { data: urlData } = await supabase.storage
                .from("freestyle-documents")
                .createSignedUrl(doc.storage_path, 600); // 10 min

              if (urlData?.signedUrl) {
                allContent.push(`UPLOADED IMAGE "${doc.name}": [Image URL available for vision processing: ${urlData.signedUrl}]`);
              }
            } else {
              allContent.push(`UPLOADED DOCUMENT "${doc.name}": [PDF document uploaded - content extraction pending]`);
            }
          } catch (e: any) {
            console.warn(`Failed to process document ${doc.name}:`, e?.message);
          }
        }
      }
    }

    await supabase
      .from("freestyle_jobs")
      .update({ status: "extracting", progress: 30, current_step: "Content extracted" })
      .eq("id", jobId);

    // Step 2: Build clinical context
    await supabase
      .from("freestyle_jobs")
      .update({ status: "retrieving", progress: 40, current_step: "Preparing clinical context" })
      .eq("id", jobId);

    const clinicalContext = allContent.length > 0
      ? allContent.join("\n\n---\n\n")
      : "No specific clinical information was provided. Generate a template H&P note.";

    // Step 3: Generate H&P via OpenAI
    await supabase
      .from("freestyle_jobs")
      .update({ status: "generating", progress: 55, current_step: "Generating H&P note with AI" })
      .eq("id", jobId);

    let resultNote: string;

    if (OPENAI_API_KEY) {
      resultNote = await generateWithOpenAI(OPENAI_API_KEY, clinicalContext);
    } else {
      console.warn("OPENAI_API_KEY not set, using basic generation");
      resultNote = generateBasicNote(clinicalContext, inputs);
    }

    // Step 4: Finalize
    await supabase
      .from("freestyle_jobs")
      .update({ status: "finalizing", progress: 90, current_step: "Saving results" })
      .eq("id", jobId);

    // Step 5: Complete
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

    console.log(`Job ${jobId} completed successfully`);

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

// ── OpenAI Generation ────────────────────────────────────────────────────────

async function generateWithOpenAI(apiKey: string, clinicalContext: string): Promise<string> {
  const systemPrompt = `You are a clinical documentation specialist. Generate a comprehensive History and Physical (H&P) note based on the provided clinical information.

IMPORTANT RULES:
- Use standard H&P format with clear section headers
- Include all relevant information from the input
- If information for a section is missing, write "[Not documented]" rather than inventing data
- Be thorough but concise
- Use proper medical terminology
- Format with clear section headers in ALL CAPS
- Do NOT fabricate any clinical details not present in the source material

Generate the H&P note with these sections:
1. CHIEF COMPLAINT
2. HISTORY OF PRESENT ILLNESS (HPI)
3. PAST MEDICAL HISTORY (PMH)
4. MEDICATIONS
5. ALLERGIES
6. SOCIAL HISTORY
7. FAMILY HISTORY
8. REVIEW OF SYSTEMS (ROS)
9. PHYSICAL EXAMINATION
10. ASSESSMENT & PLAN

Only include sections that have relevant data from the input. Skip sections entirely if no data was provided for them. For sections with partial info, document what's available and mark the rest as [Not documented].`;

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
        {
          role: "user",
          content: `Generate an H&P note from the following clinical information:\n\n${clinicalContext}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenAI API error:", response.status, errText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Error: No content generated";
}

// ── Fallback Basic Generation ────────────────────────────────────────────────

function generateBasicNote(clinicalContext: string, inputs: any): string {
  const sections: string[] = [];

  sections.push("CHIEF COMPLAINT:");
  sections.push(inputs.notes?.trim() ? inputs.notes.trim().split('\n')[0] : "[Not documented]");
  sections.push("");

  sections.push("HISTORY OF PRESENT ILLNESS:");
  sections.push(inputs.notes?.trim() || "[Not documented]");
  sections.push("");

  if (inputs.medications?.length > 0) {
    sections.push("MEDICATIONS:");
    inputs.medications.forEach((m: any) => {
      let entry = m.medication_name;
      if (m.dosage) entry += ` ${m.dosage}`;
      if (m.frequency) entry += ` (${m.frequency})`;
      sections.push(`  - ${entry}`);
    });
    sections.push("");
  }

  if (inputs.recordings?.some((r: any) => r.transcript?.trim())) {
    sections.push("ENCOUNTER TRANSCRIPTS:");
    inputs.recordings.forEach((r: any, i: number) => {
      if (r.transcript?.trim()) {
        sections.push(`Recording ${i + 1}: ${r.transcript.trim()}`);
      }
    });
    sections.push("");
  }

  sections.push("ASSESSMENT & PLAN:");
  sections.push("Clinical assessment based on provided documentation.");
  sections.push("");
  sections.push("---");
  sections.push("Note: This note was generated without AI assistance. Set OPENAI_API_KEY for full AI-powered H&P generation.");

  return sections.join("\n");
}
