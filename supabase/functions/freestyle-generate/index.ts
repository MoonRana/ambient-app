import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * freestyle-generate — Background H&P generation
 *
 * 1. Creates a job row (returned immediately)
 * 2. Background: transcribes audio, OCRs docs, assembles content
 * 3. Calls existing generate-soap-note with combined transcript
 * 4. Saves result to job row
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { patient_id, documents, recordings, notes, medications, custom_instructions, em_level } = body;

    console.log(`[freestyle] Input: notes=${notes?.length || 0}ch, meds=${medications?.length || 0}, docs=${documents?.length || 0}, recs=${recordings?.length || 0}, instructions=${custom_instructions?.length || 0}ch, em=${em_level || 'auto'}`);

    // Create job row — returned immediately
    const { data: job, error: insertError } = await supabaseClient
      .from("freestyle_jobs")
      .insert({
        user_id: user.id,
        patient_id: patient_id || null,
        status: "queued",
        progress: 0,
        current_step: "Waiting in queue",
        inputs: { documents, recordings, notes, medications, custom_instructions, em_level },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Job insert failed:", insertError);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    EdgeRuntime?.waitUntil?.(
      processJob(serviceClient, job.id, body, user.id),
    );

    return new Response(
      JSON.stringify({ job_id: job.id, status: "queued" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("freestyle-generate error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Background Job ───────────────────────────────────────────────────────────

async function processJob(supabase: any, jobId: string, inputs: any, userId: string) {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const { data: jobRow } = await supabase
    .from("freestyle_jobs")
    .select("created_at")
    .eq("id", jobId)
    .single();
  const jobCreatedAt = jobRow?.created_at ? new Date(jobRow.created_at).getTime() : Date.now();
  const processStartedAt = Date.now();

  const updateJob = (patch: Record<string, any>) =>
    supabase.from("freestyle_jobs").update(patch).eq("id", jobId);

  const logTiming = (step: string, stepStartedAt: number) => {
    const stepMs = Date.now() - stepStartedAt;
    const totalMs = Date.now() - jobCreatedAt;
    console.log(`[freestyle] Job ${jobId} timing — ${step}: ${stepMs}ms (total since created: ${totalMs}ms)`);
  };

  try {
    // ── Step 1: Extract text from all inputs ─────────────────────────────

    await updateJob({ status: "extracting", progress: 10, current_step: "Processing inputs" });

    const contentParts: string[] = [];

    // 1a. User-typed notes
    if (inputs.notes?.trim()) {
      contentParts.push(`CLINICAL NOTES:\n${inputs.notes.trim()}`);
      console.log(`[freestyle] Notes: ${inputs.notes.trim().length} chars`);
    }

    // 1b. Medications
    if (inputs.medications?.length > 0) {
      const medLines = inputs.medications.map((m: any) => {
        const parts = [m.medication_name || m.name, m.dosage || m.dose, m.frequency].filter(Boolean);
        return `  - ${parts.join(' ')}`;
      }).join("\n");
      contentParts.push(`CURRENT MEDICATIONS:\n${medLines}`);
    }

    // 1c + 1d — Transcription and document OCR in parallel
    const hasRecordings = inputs.recordings?.length > 0;
    const hasDocuments = inputs.documents?.length > 0;

    if (hasRecordings || hasDocuments) {
      await updateJob({
        progress: 20,
        current_step: hasRecordings && hasDocuments
          ? "Processing audio and documents"
          : hasRecordings
            ? "Transcribing audio recordings"
            : "Extracting text from documents",
      });
      const extractStart = Date.now();

      const [recordingParts, documentParts] = await Promise.all([
        extractAllRecordings(supabase, inputs.recordings, OPENAI_API_KEY, updateJob),
        extractAllDocuments(supabase, inputs.documents, OPENAI_API_KEY, SUPABASE_URL, SERVICE_KEY, updateJob),
      ]);

      for (const part of recordingParts) {
        if (part) contentParts.push(part);
      }
      for (const part of documentParts) {
        if (part) contentParts.push(part);
      }

      logTiming(
        `extract (recs=${recordingParts.filter(Boolean).length}, docs=${documentParts.filter(Boolean).length})`,
        extractStart,
      );
    }

    console.log(`[freestyle] Assembled ${contentParts.length} content sections, total chars: ${contentParts.join('').length}`);

    // ── Step 2: Generate note using existing generate-soap-note ──────────

    await updateJob({ status: "generating", progress: 55, current_step: "Generating clinical note" });
    const generateStart = Date.now();

    // Build directive block from custom instructions + target E/M level
    const directiveBlock = buildDirectiveBlock(inputs.custom_instructions, inputs.em_level);

    const clinicalContent = contentParts.length > 0
      ? contentParts.join("\n\n---\n\n")
      : "No clinical information was provided for this encounter.";

    // Prepend directives so they lead the prompt the note-writer receives
    const combinedTranscript = directiveBlock
      ? `${directiveBlock}\n\n---\n\n${clinicalContent}`
      : clinicalContent;

    let resultNote: string | null = null;

    // Call the proven generate-soap-note edge function
    try {
      console.log(`[freestyle] Calling generate-soap-note, transcript length: ${combinedTranscript.length}`);
      const soapResp = await fetch(`${SUPABASE_URL}/functions/v1/generate-soap-note`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "apikey": SERVICE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: jobId,
          transcript: combinedTranscript,
          patient_info: inputs.patient_info || {},
          medications: inputs.medications || [],
          diagnoses: [],
          custom_instructions: inputs.custom_instructions || "",
          em_level: inputs.em_level || null,
        }),
      });

      if (soapResp.ok) {
        const soapData = await soapResp.json();
        resultNote = soapData.full_note || null;
        console.log(`[freestyle] SOAP note generated: ${resultNote?.length || 0} chars`);
      } else {
        const errText = await soapResp.text();
        console.warn(`[freestyle] generate-soap-note returned ${soapResp.status}: ${errText.slice(0, 300)}`);
      }
    } catch (e: any) {
      console.warn(`[freestyle] generate-soap-note failed: ${e?.message}`);
    }

    // Fallback: direct OpenAI if SOAP function didn't work
    if (!resultNote && OPENAI_API_KEY) {
      console.log(`[freestyle] Fallback to direct OpenAI`);
      await updateJob({ progress: 70, current_step: "Generating note (fallback)" });
      resultNote = await generateNoteDirectly(OPENAI_API_KEY, combinedTranscript, directiveBlock);
    }

    if (!resultNote) {
      resultNote = `CLINICAL DOCUMENTATION\n\n${combinedTranscript}\n\n---\nNote: AI generation was not available. Raw clinical content shown above.`;
    }

    logTiming("note generation", generateStart);

    // Generate CME learning tidbits from the completed note
    let cmeTidbits: Array<{ id: string; topic: string; body: string }> = [];
    if (OPENAI_API_KEY && resultNote) {
      try {
        cmeTidbits = await generateCmeTidbits(OPENAI_API_KEY, resultNote);
        console.log(`[freestyle] Generated ${cmeTidbits.length} CME tidbits`);
      } catch (e: any) {
        console.warn(`[freestyle] Tidbit generation failed:`, e?.message);
      }
    }

    // ── Step 3: Complete ─────────────────────────────────────────────────

    await updateJob({
      status: "complete",
      progress: 100,
      current_step: null,
      result_note: resultNote,
      cme_tidbits: cmeTidbits,
      completed_at: new Date().toISOString(),
    });

    console.log(`[freestyle] Job ${jobId} complete — created→complete: ${Date.now() - jobCreatedAt}ms, process: ${Date.now() - processStartedAt}ms`);

  } catch (err: any) {
    console.error(`[freestyle] Job ${jobId} failed:`, err);
    await updateJob({
      status: "failed",
      error: err.message || "Processing failed",
      current_step: null,
    });
  }
}

// ── Parallel extraction helpers ─────────────────────────────────────────────

async function extractAllRecordings(
  supabase: any,
  recordings: any[] | undefined,
  openAiKey: string,
  updateJob: (patch: Record<string, any>) => Promise<any>,
): Promise<Array<string | null>> {
  if (!recordings?.length) return [];

  return Promise.all(
    recordings.map(async (rec, i) => {
      if (rec.transcript?.trim()) {
        return `ENCOUNTER RECORDING ${i + 1}:\n${rec.transcript.trim()}`;
      }
      if (!rec.storage_path || !openAiKey) return null;

      try {
        console.log(`[freestyle] Transcribing recording: ${rec.storage_path}`);
        const { data: audioData, error: dlError } = await supabase.storage
          .from("freestyle-recordings")
          .download(rec.storage_path);

        if (dlError || !audioData) {
          console.warn(`[freestyle] Download failed: ${dlError?.message}`);
          return null;
        }

        const transcript = await transcribeWithWhisper(openAiKey, audioData, rec.storage_path);
        if (transcript) {
          console.log(`[freestyle] Transcribed recording ${i + 1}: ${transcript.length} chars`);
          return `ENCOUNTER RECORDING ${i + 1} (${rec.duration_s || '?'}s):\n${transcript}`;
        }
      } catch (e: any) {
        console.warn(`[freestyle] Transcription failed for recording ${i + 1}:`, e?.message);
      }
      return null;
    }),
  );
}

async function extractAllDocuments(
  supabase: any,
  documents: any[] | undefined,
  openAiKey: string,
  supabaseUrl: string,
  serviceKey: string,
  _updateJob: (patch: Record<string, any>) => Promise<any>,
): Promise<Array<string | null>> {
  if (!documents?.length) return [];

  return Promise.all(
    documents.map((doc, i) =>
      processDocument(supabase, doc, openAiKey, supabaseUrl, serviceKey, i),
    ),
  );
}

// ── Document extraction (runs in parallel per job) ───────────────────────────

async function processDocument(
  supabase: any,
  doc: any,
  openAiKey: string,
  supabaseUrl: string,
  serviceKey: string,
  index: number,
): Promise<string | null> {
  if (!doc.storage_path) return null;

  const docLabel = doc.label ? `${doc.name} (${doc.label})` : doc.name;

  try {
    if (doc.type === "image" && openAiKey) {
      const { data: urlData } = await supabase.storage
        .from("freestyle-documents")
        .createSignedUrl(doc.storage_path, 600);

      if (urlData?.signedUrl) {
        console.log(`[freestyle] OCR-ing image ${index + 1}: ${doc.name}`);
        const extracted = await extractTextFromImage(openAiKey, urlData.signedUrl);
        if (extracted) {
          console.log(`[freestyle] Extracted from ${doc.name}: ${extracted.length} chars`);
          return `DOCUMENT "${docLabel}":\n${extracted}`;
        }
      }
      return null;
    }

    const { data: urlData } = await supabase.storage
      .from("freestyle-documents")
      .createSignedUrl(doc.storage_path, 600);

    if (!urlData?.signedUrl) return null;

    const extractResp = await fetch(`${supabaseUrl}/functions/v1/fast-medical-extract`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_url: urlData.signedUrl, document_type: doc.type }),
    });

    if (!extractResp.ok) return null;

    const extractData = await extractResp.json();
    const text = extractData.extracted_text || extractData.text || extractData.content || JSON.stringify(extractData);
    if (text && text.length > 10) {
      return `DOCUMENT "${docLabel}":\n${text}`;
    }
  } catch (e: any) {
    console.warn(`[freestyle] Doc processing failed for ${doc.name}:`, e?.message);
  }

  return null;
}

// ── Documentation directives (custom instructions + E/M level) ───────────────

const EM_LEVEL_GUIDANCE: Record<string, string> = {
  "99213": "Established patient, low complexity. Expanded problem-focused history and exam; low-complexity medical decision-making.",
  "99214": "Established patient, moderate complexity. Detailed history and exam; moderate-complexity medical decision-making.",
  "99215": "Established patient, high complexity. Comprehensive history and exam; high-complexity medical decision-making.",
  "99203": "New patient, low complexity. Detailed history and exam; low-complexity medical decision-making.",
  "99204": "New patient, moderate complexity. Comprehensive history and exam; moderate-complexity medical decision-making.",
  "99205": "New patient, high complexity. Comprehensive history and exam; high-complexity medical decision-making.",
};

function buildDirectiveBlock(customInstructions?: string, emLevel?: string | null): string {
  const parts: string[] = [];

  const instructions = (customInstructions || "").trim();
  if (instructions) {
    parts.push(`User instructions (follow exactly):\n${instructions}`);
  }

  if (emLevel && EM_LEVEL_GUIDANCE[emLevel]) {
    parts.push(
      `Target E/M level: ${emLevel} — ${EM_LEVEL_GUIDANCE[emLevel]}\n` +
      `Ensure the HPI, ROS, exam, and medical decision-making detail justify this level of service. ` +
      `End the note with a line: "Suggested E/M: ${emLevel}".`,
    );
  } else {
    parts.push(
      `No target E/M level was specified. Choose the most appropriate E/M code based on the documentation ` +
      `and end the note with a line: "Suggested E/M: <code> (rationale)".`,
    );
  }

  if (parts.length === 0) return "";

  return `DOCUMENTATION INSTRUCTIONS (highest priority — follow these over default formatting):\n${parts.join("\n\n")}`;
}

// ── Whisper Transcription ────────────────────────────────────────────────────

async function transcribeWithWhisper(apiKey: string, audioBlob: Blob, filename: string): Promise<string | null> {
  const ext = filename.includes('.webm') ? 'webm' : 'm4a';
  const formData = new FormData();
  formData.append("file", audioBlob, `recording.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("language", "en");
  formData.append("response_format", "text");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.warn(`[whisper] Error ${resp.status}: ${err.slice(0, 200)}`);
    return null;
  }

  const text = await resp.text();
  return text.trim() || null;
}

async function extractTextFromImage(apiKey: string, imageUrl: string): Promise<string | null> {
  const MIN_CHARS = 80;

  const fast = await callVisionOcr(apiKey, imageUrl, "gpt-4o-mini", "auto", 2000);
  if (fast && fast.length >= MIN_CHARS) return fast;

  console.log(`[freestyle] Fast OCR short (${fast?.length ?? 0} chars), retrying high-detail`);
  const detailed = await callVisionOcr(apiKey, imageUrl, "gpt-4o", "high", 4000);
  return detailed || fast;
}

async function callVisionOcr(
  apiKey: string,
  imageUrl: string,
  model: string,
  detail: string,
  maxTokens: number,
): Promise<string | null> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract ALL text from this medical document image. Include patient info, medications, vitals, diagnoses, labs, notes. Return raw extracted text only.",
          },
          { type: "image_url", image_url: { url: imageUrl, detail } },
        ],
      }],
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.warn(`[vision] Error ${resp.status}: ${err.slice(0, 200)}`);
    return null;
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function generateCmeTidbits(
  apiKey: string,
  note: string,
): Promise<Array<{ id: string; topic: string; body: string }>> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Generate 3-5 brief clinical learning pearls from this H&P note. Return JSON: {\"tidbits\":[{\"topic\":\"...\",\"body\":\"1-2 sentence pearl\"}]}. Focus on E/M documentation, diagnoses, meds, or one guideline tip.",
        },
        { role: "user", content: note.slice(0, 6000) },
      ],
      temperature: 0.3,
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : (parsed.tidbits || parsed.items || []);
    return items.slice(0, 5).map((t: any, i: number) => ({
      id: `tidbit_${Date.now()}_${i}`,
      topic: String(t.topic || t.title || `Learning point ${i + 1}`),
      body: String(t.body || t.text || t.pearl || ''),
    })).filter((t: any) => t.body.length > 10);
  } catch {
    return [];
  }
}

// ── OpenAI Vision OCR (legacy wrapper removed) ───────────────────────────────

// ── Direct OpenAI Note Generation (fallback) ─────────────────────────────────

async function generateNoteDirectly(apiKey: string, transcript: string, directiveBlock = ""): Promise<string> {
  const systemContent = directiveBlock
    ? `You are a clinical documentation specialist. Generate an H&P note from the provided clinical data. Only include sections with actual data — never write "[Not documented]". Use standard medical format.\n\n${directiveBlock}`
    : `You are a clinical documentation specialist. Generate an H&P note from the provided clinical data. Only include sections with actual data — never write "[Not documented]". Use standard medical format.`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        { role: "user", content: `Generate an H&P note:\n\n${transcript}` },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "Error: No content generated";
}
