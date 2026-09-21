import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Supabase injects this global at runtime; declaring it keeps `deno check` green so
// a real type error is not lost behind a permanently failing check.
declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

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

    // H&P generation runs against the full-section contract directly.
    // generate-soap-note is NOT used here: it emits a four-part SOAP note, which
    // structurally cannot carry PMH/PSH/FH/SH/Allergies/ROS/Exam that an H&P audit requires.
    if (OPENAI_API_KEY) {
      console.log(`[freestyle] Generating H&P, transcript length: ${combinedTranscript.length}`);
      try {
        resultNote = await generateNoteDirectly(OPENAI_API_KEY, combinedTranscript, directiveBlock, inputs.em_level || null, clinicalContent);
        console.log(`[freestyle] H&P generated: ${resultNote?.length || 0} chars`);
      } catch (e: any) {
        console.error(`[freestyle] H&P generation failed: ${e?.message}`);
      }
    }

    if (!resultNote) {
      // Never echo the dictation back as a "complete" note — a busy clinician will paste it into
      // a chart. The inputs are stored on the job row, so fail honestly and let them retry.
      throw new Error("The note generator is temporarily unavailable. Your inputs are saved — please try again in a moment.");
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

// Since the 2021/2023 CPT revisions every one of these families is leveled on medical
// decision-making (or time) — not on counting history and exam elements.
const EM_LEVEL_GUIDANCE: Record<string, string> = {
  // Office or clinic
  "99213": "Established patient office visit, low-complexity medical decision-making.",
  "99214": "Established patient office visit, moderate-complexity medical decision-making.",
  "99215": "Established patient office visit, high-complexity medical decision-making.",
  "99203": "New patient office visit, low-complexity medical decision-making.",
  "99204": "New patient office visit, moderate-complexity medical decision-making.",
  "99205": "New patient office visit, high-complexity medical decision-making.",
  // Nursing facility / SNF
  "99304": "Initial nursing facility care, straightforward or low-complexity medical decision-making.",
  "99305": "Initial nursing facility care, moderate-complexity medical decision-making.",
  "99306": "Initial nursing facility care, high-complexity medical decision-making.",
  "99307": "Subsequent nursing facility care, straightforward medical decision-making.",
  "99308": "Subsequent nursing facility care, low-complexity medical decision-making.",
  "99309": "Subsequent nursing facility care, moderate-complexity medical decision-making.",
  "99310": "Subsequent nursing facility care, high-complexity medical decision-making.",
  // Home or residence — includes assisted living
  "99341": "New patient home or residence visit, straightforward medical decision-making.",
  "99342": "New patient home or residence visit, low-complexity medical decision-making.",
  "99344": "New patient home or residence visit, moderate-complexity medical decision-making.",
  "99345": "New patient home or residence visit, high-complexity medical decision-making.",
  "99347": "Established patient home or residence visit, straightforward medical decision-making.",
  "99348": "Established patient home or residence visit, low-complexity medical decision-making.",
  "99349": "Established patient home or residence visit, moderate-complexity medical decision-making.",
  "99350": "Established patient home or residence visit, high-complexity medical decision-making.",
};

const MDM_TABLE =
  `Level the medical decision-making (MDM) with the standard 2-of-3 rule across Problems, Data and Risk:\n` +
  `- Straightforward: 1 self-limited or minor problem; minimal or no data; minimal risk.\n` +
  `- Low: 2+ self-limited problems, or 1 stable chronic illness, or 1 acute uncomplicated illness or injury; limited data (2 items: tests reviewed or ordered, external notes reviewed); low risk.\n` +
  `- Moderate: 2+ stable chronic illnesses, or 1+ chronic illness with exacerbation or progression, or 1 acute complicated injury, or 1 acute illness with systemic symptoms, or a new problem with uncertain prognosis; moderate data (3 items: each unique test, external document or independent historian); moderate risk (prescription drug management, which includes continuing or adjusting prescription drugs).\n` +
  `- High: 1+ chronic illness with severe exacerbation, or a threat to life or bodily function; extensive data; high risk (drug therapy requiring intensive monitoring for toxicity, a decision about hospitalization or escalation of care, parenteral controlled substances).\n` +
  `Count only problems the note actually assesses, data it actually documents, and management it actually states. ` +
  `A visit is INITIAL nursing facility care when the source describes an admission or the first comprehensive assessment of the stay; otherwise it is subsequent.\n` +
  `"High" in any column requires the specific findings named in that row: prescription drug management alone is Moderate risk, and several stable chronic illnesses are Moderate problems.`;

const EM_FAMILY_RULE =
  `Choose the E/M code FAMILY from the place of service stated in the source: office or clinic 99202-99215; ` +
  `nursing facility or SNF 99304-99310 (initial 99304-99306, subsequent 99307-99310); home or residence, which includes ` +
  `assisted living, 99341-99350 (new 99341-99345, established 99347-99350); hospital inpatient or observation 99221-99233. ` +
  `Never use an office code for a facility, assisted-living or home visit.`;

// The model judges family, visit type and MDM level; the CPT code itself is looked up
// below. Left to pick the code, it reasoned "Moderate" correctly and then chose the Low code.
const EM_CLOSING =
  `Do NOT choose a CPT code or an overall level yourself — both are computed from your basis line. End the note with exactly these two lines:\n` +
  `E/M RATIONALE: Problems — <which documented problems count and why>; Data — <which documented tests or documents count>; Risk — <which documented management counts>. If the documentation cannot support more than the lowest level, end with "Missing: <what is missing>".\n` +
  `E/M BASIS: family=<office|nursing_facility|home_residence|hospital>; type=<new|established|initial|subsequent>; problems=<straightforward|low|moderate|high>; data=<minimal|limited|moderate|extensive>; risk=<minimal|low|moderate|high>`;

const EM_CODE_MAP: Record<string, Record<string, Record<string, string>>> = {
  office: {
    new: { straightforward: "99202", low: "99203", moderate: "99204", high: "99205" },
    established: { straightforward: "99212", low: "99213", moderate: "99214", high: "99215" },
  },
  nursing_facility: {
    initial: { straightforward: "99304", low: "99304", moderate: "99305", high: "99306" },
    subsequent: { straightforward: "99307", low: "99308", moderate: "99309", high: "99310" },
  },
  home_residence: {
    new: { straightforward: "99341", low: "99342", moderate: "99344", high: "99345" },
    established: { straightforward: "99347", low: "99348", moderate: "99349", high: "99350" },
  },
  hospital: {
    initial: { straightforward: "99221", low: "99221", moderate: "99222", high: "99223" },
    subsequent: { straightforward: "99231", low: "99231", moderate: "99232", high: "99233" },
  },
};

const LEVEL_RANK: Record<string, number> = {
  straightforward: 0, minimal: 0, none: 0, low: 1, limited: 1, moderate: 2, high: 3, extensive: 3,
};
const PROBLEM_NAMES = ["straightforward", "low", "moderate", "high"];
const DATA_NAMES = ["minimal", "limited", "moderate", "extensive"];
const RISK_NAMES = ["minimal", "low", "moderate", "high"];
const FAMILY_LABEL: Record<string, string> = {
  office: "office visit",
  nursing_facility: "nursing facility care",
  home_residence: "home or residence visit",
  hospital: "hospital care",
};

// The top level must be earned in CPT's own terms. Left alone the model called ordinary
// prescription management "High risk"; without this language a claim is capped at moderate.
const HIGH_JUSTIFICATION: Record<"problems" | "data" | "risk", RegExp> = {
  problems: /severe exacerbation|threat to life|life[- ]threatening|threat to bodily function/i,
  data: /independent interpretation|independently interpreted|discussion of management|discussed with (an? )?(external|outside|consult)/i,
  risk: /intensive monitoring|toxicity|hospitali[sz]ation|escalation of care|parenteral controlled|do not resuscitate|\bDNR\b|de-escalat|emergency major surgery/i,
};

/** Visit type comes from the dictation, not the model: it labelled an admission "subsequent". */
function resolveVisitType(family: string, modelType: string, source: string): string {
  // The kind of visit is stated up front; "follow up with ortho" deep in a plan is not it.
  const head = source.slice(0, 400);
  const followUp = /\bfollow[- ]?up\b|\bsubsequent\b|\bprogress note\b|\bre-?check\b|\broutine visit\b|\bestablished patient\b|\breturn visit\b/i.test(head);
  const firstContact = /\badmitted\b|\badmission\b|\breadmi|\bnew patient\b|\binitial (visit|evaluation|assessment)\b|\bestablish(ing)? care\b|\bfirst visit\b/i.test(head);

  let first = modelType === "new" || modelType === "initial";
  if (firstContact && !followUp) first = true;
  else if (followUp && !firstContact) first = false;

  const facility = family === "nursing_facility" || family === "hospital";
  return facility ? (first ? "initial" : "subsequent") : (first ? "new" : "established");
}

/** Turn the model's basis lines into a deterministic, auditable "Suggested E/M" line. */
function finalizeEmLine(note: string, targetLevel: string | null, source = ""): string {
  const basisLine = note.match(/^E\/M BASIS:\s*(.+)$/im)?.[1] ?? "";
  const field = (k: string) => basisLine.match(new RegExp(`${k}=([a-z_]+)`, "i"))?.[1]?.toLowerCase() ?? "";

  const family = field("family");
  if (!EM_CODE_MAP[family]) return note;

  const rationale = (note.match(/^E\/M RATIONALE:\s*(.+)$/im)?.[1] ?? "").trim();
  const rank = (k: "problems" | "data" | "risk") => {
    const claimed = LEVEL_RANK[field(k)] ?? 0;
    return claimed === 3 && !HIGH_JUSTIFICATION[k].test(rationale) ? 2 : claimed;
  };
  const p = rank("problems"), d = rank("data"), r = rank("risk");

  // CPT's 2-of-3 rule: the level that at least two elements meet or exceed is the middle value.
  const mdm = PROBLEM_NAMES[[p, d, r].sort((a, b) => a - b)[1]];
  const type = resolveVisitType(family, field("type"), source);
  const computed = EM_CODE_MAP[family][type]?.[mdm];
  if (!computed) return note;

  const body = note
    .replace(/^E\/M BASIS:.*$/im, "")
    .replace(/^E\/M RATIONALE:.*$/im, "")
    .replace(/^Suggested E\/M:.*$/im, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  const summary = `${type} ${FAMILY_LABEL[family]}, ${mdm} MDM — problems ${PROBLEM_NAMES[p]}, data ${DATA_NAMES[d]}, risk ${RISK_NAMES[r]}`;
  const head = targetLevel && targetLevel !== computed
    ? `Suggested E/M: ${targetLevel} — documentation supports ${computed} (${summary}).`
    : `Suggested E/M: ${computed} (${summary}).`;

  return `${body}\n\n${head}${rationale ? ` ${rationale}` : ""}`;
}

function buildDirectiveBlock(customInstructions?: string, emLevel?: string | null): string {
  const parts: string[] = [];

  const instructions = (customInstructions || "").trim();
  if (instructions) {
    parts.push(`User instructions (follow exactly):\n${instructions}`);
  }

  if (emLevel && EM_LEVEL_GUIDANCE[emLevel]) {
    parts.push(
      `Target E/M level: ${emLevel} — ${EM_LEVEL_GUIDANCE[emLevel]}\n` +
      `Organize the medical decision-making (problems addressed, data reviewed, risk of management) so the support for this level is visible. ` +
      `Do not pad the note, infer diagnoses, or invent content to reach it.\n\n${EM_FAMILY_RULE}\n\n${MDM_TABLE}\n\n${EM_CLOSING}`,
    );
  } else {
    parts.push(
      `No target E/M level was specified. ${EM_FAMILY_RULE}\n\n${MDM_TABLE}\n\n` +
      `Level what the note supports — never more than it can defend, and never under-level a well-documented visit.\n\n${EM_CLOSING}`,
    );
  }

  parts.push(
    `E/M level governs the DEPTH of the HPI, ROS and medical decision-making narrative. ` +
    `It NEVER permits omitting a section header — every section listed in the output contract must appear regardless of E/M level.`,
  );

  return `DOCUMENTATION INSTRUCTIONS (apply these within the output contract above — they never override the required section list):\n${parts.join("\n\n")}`;
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

const REQUIRED_SECTIONS = [
  "PATIENT IDENTIFICATION",
  "CHIEF COMPLAINT",
  "HISTORY OF PRESENT ILLNESS",
  "PAST MEDICAL HISTORY",
  "PAST SURGICAL HISTORY",
  "FAMILY HISTORY",
  "SOCIAL HISTORY",
  "ALLERGIES",
  "CURRENT MEDICATIONS",
  "REVIEW OF SYSTEMS",
  "PHYSICAL EXAMINATION",
  "LABS AND DATA",
  "ASSESSMENT",
  "PLAN",
];

const ROS_SYSTEMS = [
  "Constitutional", "Eyes", "ENT/Mouth", "Cardiovascular", "Respiratory",
  "Gastrointestinal", "Genitourinary", "Musculoskeletal", "Skin",
  "Neurological", "Psychiatric", "Endocrine", "Hematologic/Lymphatic", "Allergic/Immunologic",
];

const EXAM_SYSTEMS = [
  "General Appearance", "Vital Signs", "HEENT", "Neck", "Cardiovascular",
  "Respiratory", "Abdomen", "Extremities", "Skin", "Neurological", "Psychiatric",
];

const HP_CONTRACT = `You are a clinical documentation specialist producing a History & Physical (H&P) note that must withstand a payer audit. A clinician signs this note under their license: it must contain everything they said and nothing they did not.

OUTPUT CONTRACT — follow exactly:

1. Emit EVERY one of these section headers, in this order, on its own line, in ALL CAPS followed by a colon. Never omit a header, even when the source data is silent about it:
${REQUIRED_SECTIONS.map((s) => `   ${s}:`).join("\n")}

2. FIDELITY — the source is the only truth.
   a. Never drop what the clinician said. Every diagnosis, lab value, vital sign, medication, order, precaution, follow-up interval and plan item in the source MUST appear in the note. Before finishing, re-read the source line by line and confirm each item is present.
   b. Never add what the clinician did not say. No invented findings, normal exams, diagnoses, doses or history. Status words are clinical judgments that set the billing level: never write "stable", "controlled", "well-controlled", "uncontrolled", "at goal", "improving", "worsening" or "resolved" unless the clinician used that word.
   d. Never infer a diagnosis from a medication. Amlodipine does not establish hypertension and atorvastatin does not establish hyperlipidemia. A diagnosis appears in the note only if the clinician named it. If no diagnoses were named, the ASSESSMENT states the reason for the visit in the clinician's words and nothing more.
   c. Keep the clinician's diagnostic terms exactly. Never generalize a specific diagnosis (write "acute blood loss anemia", not "postoperative anemia") — specificity drives coding.

3. MISSING INFORMATION — when the source is silent on a section, keep the header and write "Not obtained this visit" (history sections), "Not assessed" (ROS) or "Not examined" (exam). These state that the item was not documented. NEVER write an affirmative negative the clinician did not state: no "NKDA", "No known allergies", "Noncontributory", "Negative", "Normal", "None" or "Denies" unless the source says so. For ALLERGIES with no information write exactly: "Not obtained this visit — verify before prescribing."

4. REVIEW OF SYSTEMS — if the source gives ROS information for at least one system, output ALL of the following systems, one per line, in this order — every line must be present. Write "Not assessed" on the lines with no information. Never summarize them as "remainder of systems"; auditors look for each system by name. Every symptom the patient reports or denies in the source must appear here under its system, even when it is also in the HPI:
${ROS_SYSTEMS.map((s) => `   ${s}:`).join("\n")}
   File each symptom, positive or negative, under the system it belongs to: fever, chills, appetite, weight change and fatigue are Constitutional; joint or limb pain is Musculoskeletal; bowel habits are Gastrointestinal. Worked example — source says "denies chest pain, shortness of breath, fever, dysuria": write "Constitutional: Denies fever.", "Cardiovascular: Denies chest pain.", "Respiratory: Denies shortness of breath." and "Genitourinary: Denies dysuria." — four negatives, four lines, none dropped.
   If the source gives no ROS information at all, do not list the systems. Write one line: "Not obtained this visit." followed by any general statement the patient made (for example "Patient reports no new complaints.").

5. PHYSICAL EXAMINATION — if at least one exam finding besides vital signs is documented, output ALL of the following, one per line, in this order — every line must be present. Write "Not examined" on the lines with no information. Never summarize them as "remainder of systems":
${EXAM_SYSTEMS.map((s) => `   ${s}:`).join("\n")}
   File each finding under EVERY system it informs, repeating it where needed: orientation and mental status go under Neurological and Psychiatric; an incision, wound or rash goes under Skin as well as the body region; edema and calf findings go under Extremities; motor, strength or gait observations go under Neurological. Worked example — source says "right hip incision clean dry intact with staples, no erythema": write it under Extremities AND write "Skin: Right hip incision clean, dry and intact with staples, no erythema." A system is "Not examined" only when the source contains nothing about it.
   If the source documents only vital signs, write the "Vital Signs:" line and then one line: "Remainder of examination not documented."

6. LABS AND DATA — every lab value, imaging result and study in the source, each with its date when given. If there are none write "None documented this visit."

7. ASSESSMENT is a numbered problem list in the clinician's own diagnostic terms. Each line carries the documented data that supports it (values, trends, status, treatment already given). Any symptom the clinician is actively treating MUST be its own numbered problem — for example "Acute postoperative right hip pain, 5/10, on oxycodone and acetaminophen" — never folded into a general entry; opioid therapy without a documented pain assessment fails audit. PLAN addresses each numbered problem with the same numbering — exactly one plan line per problem, never several problems merged into one line. When the clinician's only instruction is general (for example "continue home meds"), repeat it on the line of each chronic problem it applies to. PLAN contains ONLY actions the clinician stated: do not add monitoring, counseling, precautions or follow-up the clinician did not order (no "monitor incision for signs of infection" unless they said it). When the clinician gave no plan for a problem, write "No change documented." If source plan items remain that belong to no problem (precautions, follow-up interval, referrals), list them under a final entry labelled "General:"; omit that entry when nothing remains, and never fill it with statements the clinician did not make.

8. FORMATTING — output PLAIN TEXT ONLY. Do NOT use markdown. No asterisks, no "**bold**", no "#" headings, no backticks. Section headers are ALL CAPS at column zero followed by a colon. This text is pasted directly into an electronic health record.`;

const FIDELITY_AUDITOR = `You are a clinical documentation auditor. Compare a clinician's SOURCE (dictation, typed notes, medication list, text read from documents) with the NOTE generated from it. Reply with JSON only: {"missing": [...], "unsupported": [...]}.

"missing" — clinical facts stated in the SOURCE that the NOTE lost: symptoms reported or denied, vital signs, exam findings, lab values, diagnoses, medications, orders, precautions, follow-up intervals. ALSO list a fact as missing when it appears somewhere in the NOTE but not in the section where it belongs: a denied symptom absent from its REVIEW OF SYSTEMS line, an exam finding absent from its system line, a lab absent from LABS AND DATA, an ordered action absent from PLAN, an actively treated symptom that has no numbered ASSESSMENT line of its own.

Two placement checks to run every time:
1. Take each symptom in every "denies …" or "reports …" list in the SOURCE, one at a time, and find it on its REVIEW OF SYSTEMS line. Fever, chills, appetite, weight change and fatigue belong on the Constitutional line; a symptom that appears only in the HPI is missing from the ROS.
2. If the SOURCE describes a symptom being treated with a medication (for example pain controlled with oxycodone), the ASSESSMENT must contain a numbered line naming that symptom itself. A fracture or surgery line that merely mentions pain control does not count.

"unsupported" — statements in the NOTE that assert a clinical fact, finding, diagnosis, status judgment ("stable", "controlled", "improving") or plan action that the SOURCE does not contain. A diagnosis inferred from a medication is unsupported.

Ignore: section headers; the placeholders "Not assessed", "Not examined", "Not obtained this visit", "Not obtained this visit — verify before prescribing", "None documented this visit", "No change documented", "Remainder of examination not documented"; standard units added to a lab value; abbreviations spelled out; the E/M RATIONALE and E/M BASIS lines.

Each item is a short phrase naming the fact and, for "missing", the section it belongs in. Return empty arrays when the note is faithful.`;

/** A second reader: prompt rules alone kept losing dictated facts and adding unordered ones. */
async function auditFidelity(
  apiKey: string,
  source: string,
  note: string,
): Promise<{ missing: string[]; unsupported: string[] }> {
  const clean = { missing: [] as string[], unsupported: [] as string[] };
  if (!source.trim()) return clean;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: FIDELITY_AUDITOR },
          { role: "user", content: `SOURCE:\n${source}\n\n---\n\nNOTE:\n${note}` },
        ],
      }),
    });
    if (!resp.ok) return clean;

    const data = await resp.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 20) : [];
    return { missing: list(parsed.missing), unsupported: list(parsed.unsupported) };
  } catch (e) {
    // Fail open: an unavailable auditor must never block a note.
    console.warn(`[freestyle] Fidelity audit skipped: ${(e as Error)?.message}`);
    return clean;
  } finally {
    clearTimeout(timer);
  }
}

async function generateNoteDirectly(
  apiKey: string,
  transcript: string,
  directiveBlock = "",
  emLevel: string | null = null,
  // The clinical content alone, without the directive block, so its wording can't be mistaken for the visit's.
  sourceText = "",
): Promise<string> {
  const systemContent = directiveBlock
    ? `${HP_CONTRACT}\n\n${directiveBlock}`
    : HP_CONTRACT;

  const messages = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: `Generate a complete History & Physical from the clinical data below. Every section listed in your instructions must appear in the output.\n\n${transcript}`,
    },
  ];

  const callModel = async (msgs: any[]) => {
    // Rate limits and 5xx are routine under load. One of them used to discard the whole
    // note and hand the clinician their own dictation back, marked "complete".
    const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
    const BACKOFF_MS = [1500, 4000];
    let resp: Response | null = null;
    let lastError = "";

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: msgs,
            // Transcribing a clinician's facts into a note is not a creative task.
            temperature: 0.1,
            max_tokens: 8000,
          }),
        });
        if (resp.ok) break;
        lastError = `OpenAI error ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
        if (!RETRYABLE.has(resp.status)) break;
      } catch (e: any) {
        lastError = `OpenAI request failed: ${e?.message}`;
        resp = null;
      }
      if (attempt < BACKOFF_MS.length) {
        console.warn(`[freestyle] ${lastError} — retrying in ${BACKOFF_MS[attempt]}ms`);
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }

    if (!resp || !resp.ok) {
      throw new Error(lastError || "OpenAI request failed");
    }

    const data = await resp.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content?.trim() || "",
      truncated: choice?.finish_reason === "length",
    };
  };

  // Continuation, section repair and fidelity repair only improve a note that already exists.
  // If one of them fails, keep the note — never trade a good draft for an error.
  const tryModel = async (msgs: any[]) => {
    try {
      return await callModel(msgs);
    } catch (e: any) {
      console.warn(`[freestyle] Optional pass skipped: ${e?.message}`);
      return { content: "", truncated: false };
    }
  };

  let { content, truncated } = await callModel(messages);

  // Model hit the ceiling mid-note — continue from where it stopped
  if (truncated && content) {
    console.warn(`[freestyle] Note truncated at ${content.length} chars, continuing`);
    const cont = await tryModel([
      ...messages,
      { role: "assistant", content },
      { role: "user", content: "Continue the note from exactly where you stopped. Do not repeat any text already written." },
    ]);
    content = `${content}\n${cont.content}`.trim();
  }

  if (!content) throw new Error("The model returned an empty note.");

  // Completeness gate — repair any missing required headers rather than shipping a partial note
  const missing = REQUIRED_SECTIONS.filter(
    (s) => !new RegExp(`^\\s*${s.replace(/[/&]/g, "\\$&")}\\s*:`, "im").test(content),
  );

  if (missing.length > 0) {
    console.warn(`[freestyle] Missing sections after generation: ${missing.join(", ")} — repairing`);
    const repair = await tryModel([
      { role: "system", content: systemContent },
      { role: "user", content: `Generate a complete History & Physical from this clinical data:\n\n${transcript}` },
      { role: "assistant", content },
      {
        role: "user",
        content: `This note is missing these required sections: ${missing.join(", ")}.\n\nReturn the COMPLETE note again with every required section present. Keep all existing content unchanged and add the missing sections in their correct position.`,
      },
    ]);
    if (repair.content && repair.content.length > content.length * 0.7) {
      content = repair.content;
    }
  }

  if (sourceText) {
    const audit = await auditFidelity(apiKey, sourceText, content);

    // Structure is checkable in code — no need to hope a model notices a missing plan line.
    const sectionBody = (name: string) => {
      const start = content.search(new RegExp(`^${name}:`, "m"));
      if (start < 0) return "";
      const rest = content.slice(start + name.length + 1);
      const end = rest.search(/\n\n(?:[A-Z][A-Z /&-]+:|E\/M |Suggested E\/M)/);
      return end < 0 ? rest : rest.slice(0, end);
    };
    const countNumbered = (name: string) =>
      sectionBody(name).split("\n").filter((l: string) => /^\s*\d+\./.test(l)).length;
    const problems = countNumbered("ASSESSMENT");
    const planLines = countNumbered("PLAN");
    if (problems > 0 && planLines !== problems) {
      audit.missing.push(
        `PLAN has ${planLines} numbered lines for ${problems} ASSESSMENT problems — give every problem its own plan line with the same number, writing "No change documented." where the clinician gave no plan`,
      );
    }

    // An opioid with no standalone pain assessment is what a controlled-substance audit looks for.
    // The model kept folding pain into the fracture line, so this is checked in code too.
    const OPIOID = /\b(oxycodone|hydrocodone|morphine|tramadol|hydromorphone|fentanyl|methadone|oxycontin|percocet|norco|tapentadol|codeine)\b/i;
    if (/\bpain\b/i.test(sourceText) && OPIOID.test(sourceText)) {
      const hasPainProblem = sectionBody("ASSESSMENT").split("\n").some(
        (l: string) => /^\s*\d+\./.test(l) && /\bpain\b/i.test(l.split(",")[0]),
      );
      if (!hasPainProblem) {
        audit.missing.push(
          `ASSESSMENT needs its own numbered problem that leads with the pain being treated with an opioid — for example "Acute postoperative right hip pain, 5/10, on oxycodone and acetaminophen" — with a matching numbered PLAN line. Do not fold it into the fracture or surgery line`,
        );
      }
    }

    if (audit.missing.length > 0 || audit.unsupported.length > 0) {
      console.warn(`[freestyle] Fidelity audit — missing: ${JSON.stringify(audit.missing)} | unsupported: ${JSON.stringify(audit.unsupported)}`);
      const instructions = [
        "A fidelity audit compared this note with the source and found problems.",
        audit.missing.length
          ? `ADD these source facts, each in the section where it belongs (a denied symptom on its REVIEW OF SYSTEMS line, a lab in LABS AND DATA, an ordered action in PLAN, an actively treated symptom as its own numbered problem):\n${audit.missing.map((m) => `- ${m}`).join("\n")}`
          : "",
        audit.unsupported.length
          ? `REMOVE these statements, which the source does not support:\n${audit.unsupported.map((u) => `- ${u}`).join("\n")}`
          : "",
        "Change nothing else. Return the COMPLETE note, including the final E/M RATIONALE and E/M BASIS lines.",
      ].filter(Boolean).join("\n\n");

      const fixed = await tryModel([
        { role: "system", content: systemContent },
        { role: "user", content: `Generate a complete History & Physical from this clinical data:\n\n${transcript}` },
        { role: "assistant", content },
        { role: "user", content: instructions },
      ]);
      if (fixed.content && fixed.content.length > content.length * 0.7) {
        content = fixed.content;
      }
    }
  }

  return finalizeEmLine(content, emLevel, sourceText);
}
