import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { assertAnthropicModelsValid } from "../_shared/validate-anthropic-models.ts";
import { authErrorResponse, requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractedDocumentInfo {
  type: 'insurance' | 'patient_id' | 'clinical';
  side: 'front' | 'back' | 'other';
  data: {
    member_id?: string;
    group_number?: string;
    payer_name?: string;
    plan_type?: string;
    full_name?: string;
    date_of_birth?: string;
    address?: string;
    phone?: string;
    name?: string; // Alias for full_name to match PatientInfo interface
    [key: string]: string | undefined;
  };
  confidence: number;
}

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

/**
 * Identify an image from its leading bytes. Returns null when the signature is
 * unrecognized so the caller can fall back to whatever was declared.
 */
function sniffImageType(base64: string): string | null {
  let head: Uint8Array;
  try {
    const bin = atob(base64.slice(0, 64));
    head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (head.length < 12) return null;

  const hex = (n: number) => head[n];
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...head.slice(start, start + len));

  if (hex(0) === 0xff && hex(1) === 0xd8 && hex(2) === 0xff) return 'image/jpeg';
  if (hex(0) === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';

  // ISO-BMFF container: bytes 4-8 are "ftyp", the brand that follows tells us which
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).toLowerCase();
    if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return 'image/heic';
    if (brand.startsWith('avif') || brand === 'avis') return 'image/avif';
  }

  if (ascii(0, 5) === '%PDF-') return 'application/pdf';

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // BATCH 15: PHI-handling function. Authentication is mandatory — no anonymous
  // path and no client-supplied user id. Identity comes from the verified JWT.
  let caller;
  try {
    caller = await requireUser(req);
  } catch (authError) {
    console.error('extract-document-info: rejected unauthenticated request');
    return authErrorResponse(authError, corsHeaders);
  }
  void caller;



  await assertAnthropicModelsValid();
  try {
    const { image_base64, extracted_text, document_type, side } = await req.json();

    if (!image_base64 && !extracted_text) {
      throw new Error('Either image_base64 or extracted_text is required');
    }

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    // Enhanced prompts with explicit field extraction
    const insurancePrompt = `You will be given content from ${side === 'other' ? 'a document containing insurance information (could be paper, printout, or any document with insurance details)' : `the ${side} of an insurance card`}. 

Extract the following fields as JSON - these are CRITICAL for patient registration:
{
  "member_id": "The member ID or subscriber ID number (very important)",
  "group_number": "The group number or group ID (very important)", 
  "payer_name": "Insurance company name (e.g., BlueCross, Aetna, UnitedHealthcare)",
  "plan_type": "Plan type if shown (HMO, PPO, etc.)",
  "bin_number": "BIN number if present (pharmacy benefit)",
  "pcn": "PCN if present",
  "rx_group": "Rx group if present",
  "subscriber_name": "Name on the card if visible"
}

Important:
- Member ID is often labeled as "Member #", "ID #", "Subscriber ID", "Member Number"
- Group Number is often labeled as "Group #", "GRP", "Group Number", "Grp #"
- These are the two most important fields - look carefully for them
- Return ONLY a valid JSON object
- Use null for fields not found`;

    const patientIdPrompt = `You will be given content from the ${side} of a patient ID/driver's license (either an image or extracted PDF text). Extract the following fields as JSON:
{
  "full_name": "Full legal name",
  "date_of_birth": "Date of birth in YYYY-MM-DD format if possible",
  "address": "Full address",
  "id_number": "ID or license number",
  "expiration_date": "Expiration date if visible",
  "sex": "M or F"
}

Return ONLY a valid JSON object. Use null for fields not found.`;

    const clinicalPrompt = `You are a clinical document extraction AI. Extract ALL clinical information from this document (discharge summary, CCD, medication list, lab report, vitals sheet, or any clinical document).

Return ONLY a valid JSON object with these fields:
{
  "extracted_text": "Complete readable transcription of ALL clinical content in the document, preserving all details",
  "medications": [{"name": "Drug name", "dose": "Dosage", "frequency": "How often", "route": "PO/IV/etc", "source": "home_med_list | discharge_summary | mar | ccd | unknown"}],
  "discharge_medications": [{"name": "Drug name", "dose": "Dosage", "frequency": "How often", "route": "PO/IV/etc", "indication": "Why prescribed if stated"}],
  "diagnoses": [{"description": "Diagnosis name", "icd10": "ICD-10 code if visible"}],
  "vitals": {"bp": "Blood pressure", "hr": "Heart rate", "temp": "Temperature", "o2_sat": "O2 saturation", "weight": "Weight", "height": "Height", "rr": "Respiratory rate", "bmi": "BMI"},
  "labs": [{"name": "Lab name", "value": "Result value", "unit": "Unit", "reference_range": "Normal range", "is_abnormal": true/false}],
  "allergies": ["Allergy 1", "Allergy 2"],
  "social_history": {"tobacco": "Smoking status and pack-years", "alcohol": "Alcohol use", "drugs": "Drug use"},
  "echo_findings": {"ef": "Ejection fraction %", "wall_motion": "Wall motion abnormalities", "valves": "Valve findings", "chambers": "Chamber sizes", "date": "Study date if visible"},
  "ekg_findings": {"rhythm": "Rhythm", "rate": "Rate", "intervals": "PR/QRS/QTc", "st_changes": "ST segment changes", "date": "Study date if visible"},
  "hpi": "History of present illness narrative",
  "discharge_instructions": "Discharge instructions if present",
  "procedures": [{"name": "Procedure name", "date": "Date if visible", "findings": "Key findings"}],
  "hospital_course": {
    "admission_date": "Admission date if stated",
    "admission_diagnosis": "Reason for admission",
    "course_bullets": ["Chronological bullet 1", "Chronological bullet 2"],
    "procedures_performed": ["Procedure 1 with date", "Procedure 2 with date"],
    "consults": ["Specialty consults seen during stay"],
    "complications": ["Any in-hospital complications"],
    "discharge_date": "Discharge date if stated",
    "discharge_disposition": "Where the patient went (home, SNF, rehab, AMA, expired)",
    "pending_studies": ["Any tests pending at discharge"]
  },
  "mds_flags": {
    "recent_fall": "Yes/No/Not documented + details if yes",
    "pressure_ulcer": "Yes/No/Not documented + stage/location if yes",
    "restraint_use": "Yes/No/Not documented + type if yes",
    "antipsychotic_use": "Yes/No/Not documented + drug if yes",
    "weight_loss": "Yes/No/Not documented + amount/timeframe if yes",
    "dehydration": "Yes/No/Not documented + indicators if yes",
    "cognition_concern": "Yes/No/Not documented + screening tool/score if available",
    "mood_concern": "Yes/No/Not documented + PHQ-9 or other if available",
    "behavior_concern": "Yes/No/Not documented + description if yes",
    "functional_status": "Independent / Requires assistance / Dependent / Not documented — describe ADLs",
    "therapy_needs": "PT/OT/ST needs noted",
    "skin_integrity": "Description of skin issues beyond pressure ulcers"
  }
}

CRITICAL RULES:
- Extract EVERYTHING visible in the document — do not skip any content
- The "extracted_text" field must contain the FULL readable text of the document
- For medications, capture exact dose and frequency (e.g., "Metoprolol 25mg BID")
- For "discharge_medications", ONLY populate if you see a discharge medication reconciliation list — leave as empty array otherwise
- For "hospital_course", populate only if this document is a discharge summary, hospital course summary, or transfer summary — leave fields null otherwise
- For "mds_flags", scan the entire document for SNF/LTC-relevant signals — these feed the MDS 3.0 nursing workflow
- Use null for fields not found — NEVER hallucinate or fabricate data
- If a field has no data, use null (not empty string)
- For arrays with no data, use empty array []`;

    const prompt = document_type === 'clinical' ? clinicalPrompt : document_type === 'insurance' ? insurancePrompt : patientIdPrompt;

    // Clinical cap raised 4096 → 8192 (Kelly Jul 2026): the structured JSON
    // (medications array + full extracted_text) was hitting the output limit
    // and truncating medication lists on long documents.
    const maxTokens = document_type === 'clinical' ? 8192 : 1024;

    let response: Response;

    // If PDF/text was uploaded, run text-only extraction
    if (extracted_text) {
      console.log('[extract-document-info] Processing extracted text, length:', String(extracted_text).length);

      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `${prompt}\n\n--- EXTRACTED DOCUMENT TEXT START ---\n${extracted_text}\n--- EXTRACTED DOCUMENT TEXT END ---` },
              ],
            },
          ],
        }),
      });
    } else {
      // Process as image
      const declaredMatch = image_base64.match(/^data:(image\/[\w+-]+);base64,/);
      const declaredType = declaredMatch ? declaredMatch[1].toLowerCase() : null;

      // Clean the base64 data
      let cleanBase64 = image_base64;
      if (cleanBase64.includes(',')) {
        cleanBase64 = cleanBase64.split(',')[1];
      }
      cleanBase64 = cleanBase64.replace(/\s/g, '');

      // Trust the bytes, not the caller. A client that falls back to reading the
      // original file ships HEIC from an iPhone with no data: prefix, which would
      // otherwise be mislabelled image/jpeg and rejected by Anthropic as a 500.
      const sniffed = sniffImageType(cleanBase64);
      const mediaType = sniffed ?? declaredType ?? 'image/jpeg';

      if (sniffed && declaredType && sniffed !== declaredType) {
        console.warn(`[extract-document-info] Declared ${declaredType} but bytes are ${sniffed} — using ${sniffed}`);
      }

      if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
        console.error('[extract-document-info] Unsupported image format:', mediaType);
        const isHeic = mediaType === 'image/heic' || mediaType === 'image/heif';
        return new Response(
          JSON.stringify({
            error: isHeic
              ? 'This photo is in Apple\'s HEIC format, which cannot be read. On your iPhone open Settings > Camera > Formats and choose "Most Compatible", then retake the photo.'
              : `Unsupported file format: ${mediaType}. Please use a JPEG, PNG, GIF, WebP, or PDF.`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[extract-document-info] Processing image, base64 length:', cleanBase64.length, 'mediaType:', mediaType);

      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: [
                mediaType === 'application/pdf'
                  ? {
                      type: 'document',
                      source: { type: 'base64', media_type: 'application/pdf', data: cleanBase64 },
                    }
                  : {
                      type: 'image',
                      source: { type: 'base64', media_type: mediaType, data: cleanBase64 },
                    },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const result = await response.json();
    const content = result.content[0].text;

    // Parse JSON from response
    let extractedData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        extractedData = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Failed to parse extraction result, using raw content as fallback:', content);
      extractedData = { extracted_text: content };
    }

    console.log('[extract-document-info] Parsed keys:', Object.keys(extractedData));

    // Map fields to match PatientInfo interface
    const mappedData: Record<string, string | undefined> = { ...extractedData };
    
    // Map full_name to name for PatientInfo compatibility
    if (extractedData.full_name && !mappedData.name) {
      mappedData.name = extractedData.full_name;
    }
    if (extractedData.subscriber_name && !mappedData.name) {
      mappedData.name = extractedData.subscriber_name;
    }

    // Build top-level extracted_text for clinical docs (app compatibility)
    const topLevelText = extractedData.extracted_text || content;
    const rawContext = typeof extractedData === 'object' 
      ? JSON.stringify(extractedData) 
      : String(content);

    // Surface structured clinical fields at top level (additive — existing callers unaffected)
    const hospitalCourse = extractedData?.hospital_course ?? null;
    const dischargeMedications = Array.isArray(extractedData?.discharge_medications)
      ? extractedData.discharge_medications
      : null;
    const mdsFlags = extractedData?.mds_flags ?? null;

    const extractedInfo = {
      type: document_type,
      side,
      data: mappedData,
      extracted_text: topLevelText,
      raw_context: rawContext,
      confidence: extracted_text ? 0.75 : 0.85,
      success: true,
      // New structured fields (only meaningful for clinical document_type)
      hospital_course: hospitalCourse,
      discharge_medications: dischargeMedications,
      mds_flags: mdsFlags,
    };

    return new Response(JSON.stringify(extractedInfo), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in extract-document-info:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});