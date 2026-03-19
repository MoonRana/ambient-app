import { supabase } from './supabase';
import { AmbientSession } from './session-context';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

const POLLING_INTERVAL = 5000;
const MAX_ATTEMPTS = 120; // 10 minutes total (120 * 5s)

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Default 120s for most edge function calls; audio upload uses 300s
async function fetchWithTimeout(url: string, options: any, timeout = 120000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    // Give a clearer error message for timeouts vs network failures
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your internet connection and try again.');
    }
    throw new Error(`Network request failed: ${error.message || 'Unknown error'}. Check your internet connection.`);
  }
}

async function getAuthHeaders() {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || anonKey;
  return {
    'Authorization': `Bearer ${token}`,
    'apikey': anonKey,           // Required by Supabase Edge Functions
    'Content-Type': 'application/json',
  };
}

function getBaseUrl() {
  return (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
}

export async function uploadAudioToS3(audioUri: string, sessionId: string): Promise<{
  success: boolean;
  s3_uri?: string;
  file_key?: string;
  size_bytes?: number;
  error?: string;
}> {
  let audioBase64: string;

  if (Platform.OS === 'web') {
    const response = await fetch(audioUri);
    const blob = await response.blob();
    audioBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } else {
    audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  const headers = await getAuthHeaders();
  const contentType = audioUri.endsWith('.webm') ? 'audio/webm' : 'audio/m4a';

  // Audio files can be large — allow up to 5 minutes for upload
  const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/upload-audio-to-s3`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      audio_base64: audioBase64,
      content_type: contentType,
      session_id: sessionId,
    }),
  }, 300000); // 5 minute timeout for audio upload

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to upload audio');
  }
  return data;
}

export async function startHealthScribeJob(sessionId: string, audioS3Uri: string): Promise<{
  job_name: string;
  job_id: string;
  status: string;
  output_location?: string;
}> {
  const headers = await getAuthHeaders();

  const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/start-healthscribe-job`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      audio_s3_uri: audioS3Uri,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to start HealthScribe job');
  }
  return data;
}

export async function getHealthScribeStatus(jobName: string): Promise<{
  job_name: string;
  status: 'IDLE' | 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  transcript?: { uri: string };
  clinical_data?: { uri: string };
  failure_reason?: string;
}> {
  const headers = await getAuthHeaders();

  const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/get-healthscribe-status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ job_name: jobName }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to get HealthScribe status');
  }
  return data;
}

export async function fetchHealthScribeResults(transcriptUri: string, clinicalUri: string): Promise<{
  transcript: {
    raw: any;
    segments: any[];
    formatted: string;
  };
  clinical: {
    raw: any;
    sections: any[];
  };
  summary: {
    chiefComplaint?: string;
    historyOfPresentIllness?: string;
    assessment?: string;
    plan?: string;
  };
}> {
  const headers = await getAuthHeaders();

  const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/fetch-healthscribe-results`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      transcript_uri: transcriptUri,
      clinical_uri: clinicalUri,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch HealthScribe results');
  }
  return data;
}

export async function generateSOAPNote(params: {
  session_id: string;
  patient_info?: {
    name?: string;
    date_of_birth?: string;
    member_id?: string;
    group_number?: string;
    payer_name?: string;
    address?: string;
  };
  medications?: Array<{
    medication_name: string;
    dosage?: string;
    frequency?: string;
  }>;
  diagnoses?: Array<{
    diagnosis_name: string;
    icd10_code: string;
    is_primary?: boolean;
  }>;
  transcript?: string;
  healthscribe_summary?: any;
}): Promise<{
  full_note: string;
  sections: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    followUp?: string;
  };
  generated_at: string;
}> {
  const headers = await getAuthHeaders();

  const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/generate-soap-note`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to generate SOAP note');
  }
  return data;
}

export async function analyzeInsuranceCard(imageUri: string): Promise<{
  member_id?: string;
  group_number?: string;
  payer_name?: string;
  patient_name?: string;
  address?: string;
  date_of_birth?: string;
  confidence?: number;
}> {
  let imageBase64: string;
  let mimeType = 'image/jpeg';

  if (Platform.OS === 'web') {
    const response = await fetch(imageUri);
    const blob = await response.blob();
    // On web resize via canvas to keep payload small
    imageBase64 = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  } else {
    // Native: resize to max 1200px wide and compress to JPEG 70% before encoding
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 1200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      imageBase64 = await FileSystem.readAsStringAsync(manipulated.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      // Fallback: read original if manipulator fails
      imageBase64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  }

  // Sanity check — warn if still large (Claude limit ~5MB base64)
  console.log('[analyzeInsuranceCard] Image base64 length:', imageBase64.length, 'chars (~', Math.round(imageBase64.length * 0.75 / 1024), 'KB raw)');
  if (imageBase64.length > 4_000_000) {
    console.warn('[analyzeInsuranceCard] Image still very large after resize:', imageBase64.length, 'chars');
  }

  const headers = await getAuthHeaders();

  const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/extract-document-info`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image_base64: imageBase64,
      mime_type: mimeType,
      document_type: 'insurance',
      side: 'front',
    }),
  });

  const rawText = await response.text();
  console.log('[analyzeInsuranceCard] HTTP status:', response.status);
  console.log('[analyzeInsuranceCard] Raw response:', rawText.slice(0, 500));

  let data: any;
  try { data = JSON.parse(rawText); } catch { data = { error: rawText }; }

  if (!response.ok) {
    // The function wraps Anthropic errors — try multiple paths
    const errMsg =
      data.error ||
      data.message ||
      data?.details?.error?.message ||
      data?.error_message ||
      `HTTP ${response.status}: ${rawText.slice(0, 200)}`;
    console.error('[analyzeInsuranceCard] Error detail:', JSON.stringify(data));
    throw new Error(errMsg);
  }

  // Edge function returns { type, side, data: { ...fields }, confidence }
  // Normalise both flat and nested shapes
  const fields = data.data ?? data;
  return {
    member_id: fields.member_id ?? fields.memberId,
    group_number: fields.group_number ?? fields.groupNumber,
    payer_name: fields.payer_name ?? fields.payerName ?? fields.insurance_company ?? fields.insuranceCompany,
    patient_name: fields.patient_name ?? fields.patientName ?? fields.name,
    address: fields.address,
    date_of_birth: fields.date_of_birth ?? fields.dateOfBirth ?? fields.dob,
    confidence: data.confidence,
  };
}

/**
 * Extract all clinical information from any medical document image.
 *
 * Unlike analyzeInsuranceCard() which only looks for insurance fields,
 * this function extracts the full clinical content of a document:
 *   – Medications (name, dose, frequency, route)
 *   – Diagnoses / ICD-10 codes
 *   – Vitals (BP, HR, temp, SpO2, weight, height)
 *   – Lab results (with values and reference ranges)
 *   – Allergies
 *   – HPI / chief complaint
 *   – Discharge instructions / plan
 *   – Any other clinical narrative text
 *
 * Returns a free-text string ready to be appended to documentContext,
 * or null if extraction fails (non-fatal).
 */
export async function extractClinicalDocument(imageUri: string): Promise<string | null> {
  let imageBase64: string;
  const mimeType = 'image/jpeg';

  try {
    if (Platform.OS === 'web') {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      imageBase64 = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1600; // slightly larger for clinical docs — more text to read
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
      });
    } else {
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          imageUri,
          [{ resize: { width: 1600 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        imageBase64 = await FileSystem.readAsStringAsync(manipulated.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch {
        imageBase64 = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
    }
  } catch (e: any) {
    console.warn('[extractClinicalDocument] Failed to encode image:', e?.message);
    return null;
  }

  try {
    const headers = await getAuthHeaders();
    const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/extract-document-info`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image_base64: imageBase64,
        mime_type: mimeType,
        document_type: 'clinical',
      }),
    });

    const rawText = await response.text();
    console.log('[extractClinicalDocument] HTTP status:', response.status);

    if (!response.ok) {
      console.warn('[extractClinicalDocument] Non-200 response:', rawText.slice(0, 300));
      return null;
    }

    let data: any;
    try { data = JSON.parse(rawText); } catch { return rawText.trim() || null; }

    // The edge function may return:
    //   { text: "..." }          — free-text OCR result
    //   { data: { ... } }        — structured fields
    //   { raw_text: "..." }      — some implementations use this key
    // We prefer free-text; fall back to JSON-stringifying the structured data.
    if (typeof data?.text === 'string' && data.text.trim()) return data.text.trim();
    if (typeof data?.raw_text === 'string' && data.raw_text.trim()) return data.raw_text.trim();

    // Build a human-readable summary from whatever structured fields came back
    const d = data?.data ?? data ?? {};
    const parts: string[] = [];

    if (d.patient_name || d.patientName)
      parts.push(`Patient: ${d.patient_name ?? d.patientName}`);
    if (d.date_of_birth || d.dateOfBirth || d.dob)
      parts.push(`DOB: ${d.date_of_birth ?? d.dateOfBirth ?? d.dob}`);

    // Medications — may come as array or string
    const meds = d.medications ?? d.medication_list ?? d.meds;
    if (Array.isArray(meds) && meds.length > 0) {
      parts.push('Medications:');
      meds.forEach((m: any) => {
        if (typeof m === 'string') { parts.push(`  - ${m}`); return; }
        const medLine = [
          m.name ?? m.medication_name,
          m.dose ?? m.dosage,
          m.frequency ?? m.freq,
          m.route,
        ].filter(Boolean).join(' ');
        if (medLine) parts.push(`  - ${medLine}`);
      });
    } else if (typeof meds === 'string' && meds.trim()) {
      parts.push(`Medications: ${meds.trim()}`);
    }

    // Diagnoses
    const dx = d.diagnoses ?? d.diagnosis_list ?? d.problems;
    if (Array.isArray(dx) && dx.length > 0) {
      parts.push('Diagnoses:');
      dx.forEach((x: any) => {
        if (typeof x === 'string') { parts.push(`  - ${x}`); return; }
        const dxLine = [x.name ?? x.diagnosis_name, x.icd10_code ?? x.icd10].filter(Boolean).join(' ');
        if (dxLine) parts.push(`  - ${dxLine}`);
      });
    } else if (typeof dx === 'string' && dx.trim()) {
      parts.push(`Diagnoses: ${dx.trim()}`);
    }

    // Vitals
    const vitals = d.vitals ?? d.vital_signs;
    if (vitals && typeof vitals === 'object') {
      const vitalParts = Object.entries(vitals)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}: ${v}`);
      if (vitalParts.length) parts.push(`Vitals: ${vitalParts.join(', ')}`);
    } else if (typeof vitals === 'string' && vitals.trim()) {
      parts.push(`Vitals: ${vitals.trim()}`);
    }

    // Labs
    const labs = d.labs ?? d.lab_results ?? d.laboratory;
    if (Array.isArray(labs) && labs.length > 0) {
      parts.push('Labs:');
      labs.forEach((l: any) => {
        if (typeof l === 'string') { parts.push(`  - ${l}`); return; }
        const labLine = [l.name ?? l.test, l.value ?? l.result, l.unit, l.reference_range ?? l.ref_range]
          .filter(Boolean).join(' ');
        if (labLine) parts.push(`  - ${labLine}`);
      });
    }

    // Allergies
    const allergies = d.allergies ?? d.allergy_list;
    if (Array.isArray(allergies) && allergies.length > 0) {
      parts.push(`Allergies: ${allergies.map((a: any) => (typeof a === 'string' ? a : a.name ?? JSON.stringify(a))).join(', ')}`);
    } else if (typeof allergies === 'string' && allergies.trim()) {
      parts.push(`Allergies: ${allergies.trim()}`);
    }

    // Narrative fields
    ['chief_complaint', 'hpi', 'history_of_present_illness', 'assessment', 'plan',
      'discharge_instructions', 'narrative', 'summary'].forEach(key => {
        const val = d[key] ?? d[key.replace(/_/g, '')] ?? d[key.replace(/_(\w)/g, (_, c) => c.toUpperCase())];
        if (typeof val === 'string' && val.trim()) {
          parts.push(`${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${val.trim()}`);
        }
      });

    const result = parts.join('\n');
    console.log('[extractClinicalDocument] Extracted', parts.length, 'sections,', result.length, 'chars');
    return result || null;
  } catch (e: any) {
    console.warn('[extractClinicalDocument] Extraction failed:', e?.message);
    return null;
  }
}

/**
 * Extract medications from a photo of a pill bottle or printed medication list.
 *
 * Calls the `extract-medications` edge function which returns structured
 * medication data: name, dosage, frequency, route, and any notes.
 *
 * @param imageUri  Local image URI (file:// or content://)
 * @param isMedList true for a printed medication list; false for a single pill bottle
 */
export interface ExtractedMedication {
  name: string;
  dose?: string;
  frequency?: string;
  route?: string;
  notes?: string;
}

export async function extractMedications(
  imageUri: string,
  isMedList: boolean = false,
): Promise<ExtractedMedication[]> {
  let imageBase64: string;

  try {
    if (Platform.OS === 'web') {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      imageBase64 = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1400;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
      });
    } else {
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          imageUri,
          [{ resize: { width: 1400 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        imageBase64 = await FileSystem.readAsStringAsync(manipulated.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch {
        imageBase64 = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
    }
  } catch (e: any) {
    console.warn('[extractMedications] Failed to encode image:', e?.message);
    return [];
  }

  console.log('[extractMedications] Image base64 length:', imageBase64.length, 'chars, isMedList:', isMedList);

  try {
    const headers = await getAuthHeaders();
    const response = await fetchWithTimeout(`${getBaseUrl()}/functions/v1/extract-medications`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image_base64: imageBase64,
        is_med_list: isMedList,
      }),
    });

    const rawText = await response.text();
    console.log('[extractMedications] HTTP status:', response.status);

    if (!response.ok) {
      console.warn('[extractMedications] Non-200 response:', rawText.slice(0, 300));
      throw new Error(`Medication extraction failed: HTTP ${response.status}`);
    }

    let data: any;
    try { data = JSON.parse(rawText); } catch { return []; }

    // Normalise response — could be { medications: [...] }, { data: [...] }, or just [...]
    const meds: any[] = data?.medications ?? data?.data ?? (Array.isArray(data) ? data : []);

    return meds.map((m: any) => ({
      name: m.name ?? m.medication_name ?? m.drug_name ?? 'Unknown',
      dose: m.dose ?? m.dosage ?? m.strength,
      frequency: m.frequency ?? m.freq ?? m.schedule,
      route: m.route,
      notes: m.notes ?? m.instructions ?? m.sig,
    }));
  } catch (e: any) {
    console.warn('[extractMedications] Extraction failed:', e?.message);
    throw e;
  }
}

export type ProcessingStep = 'uploading' | 'starting' | 'processing' | 'fetching' | 'generating' | 'complete' | 'error';

export interface ProcessingProgress {
  step: ProcessingStep;
  message: string;
  progress: number;
}

export async function processRecordingToSOAP(
  audioUri: string,
  sessionId: string,
  patientContext: string,
  onProgress: (progress: ProcessingProgress) => void,
  patientInfo?: AmbientSession['patientInfo'],
  documentContext?: string,   // ← free-text OCR block from scanned documents
): Promise<{
  soapNote: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    followUp?: string;
  };
  transcript?: string;
  fullNote?: string;
}> {
  try {
    onProgress({ step: 'uploading', message: 'Uploading audio...', progress: 0.1 });

    const uploadResult = await uploadAudioToS3(audioUri, sessionId);
    if (!uploadResult.success || !uploadResult.s3_uri) {
      throw new Error('Audio upload failed');
    }

    onProgress({ step: 'starting', message: 'Starting transcription...', progress: 0.2 });

    const job = await startHealthScribeJob(sessionId, uploadResult.s3_uri);

    onProgress({ step: 'processing', message: 'Analyzing audio...', progress: 0.3 });

    let attempts = 0;
    let status = await getHealthScribeStatus(job.job_name);

    while (status.status !== 'COMPLETED' && status.status !== 'FAILED' && attempts < MAX_ATTEMPTS) {
      console.log(`[HealthScribe] Polling attempt ${attempts + 1}/${MAX_ATTEMPTS}. Status: ${status.status}`);
      await sleep(POLLING_INTERVAL);
      status = await getHealthScribeStatus(job.job_name);
      attempts++;

      const pollProgress = Math.min(0.3 + (attempts / MAX_ATTEMPTS) * 0.4, 0.7);
      console.log(`[HealthScribe] Progress: ${Math.round(pollProgress * 100)}%`);
      onProgress({
        step: 'processing',
        message: status.status === 'IN_PROGRESS' ? 'Processing transcription...' : 'Waiting in queue...',
        progress: pollProgress,
      });
    }

    console.log(`[HealthScribe] Final status: ${status.status} after ${attempts} attempts`);

    if (status.status === 'FAILED') {
      throw new Error(status.failure_reason || 'Transcription failed');
    }

    if (status.status !== 'COMPLETED') {
      throw new Error('Processing timed out');
    }

    onProgress({ step: 'fetching', message: 'Retrieving results...', progress: 0.75 });

    const results = await fetchHealthScribeResults(
      status.transcript!.uri,
      status.clinical_data!.uri,
    );

    onProgress({ step: 'generating', message: 'Generating SOAP note...', progress: 0.85 });

    // Assemble the full transcript: prepend document context if available
    const baseTranscript = results.transcript.formatted;
    const fullTranscript = documentContext
      ? `PATIENT DOCUMENTS (scanned):\n${documentContext}\n\n---\n\nENCOUNTER TRANSCRIPT:\n${baseTranscript}`
      : baseTranscript;

    console.log('[processRecordingToSOAP] transcript length:', fullTranscript.length, 'hasDocCtx:', !!documentContext);

    const soapResult = await generateSOAPNote({
      session_id: sessionId,
      patient_info: {
        name: patientInfo?.name || patientContext || '',
        date_of_birth: patientInfo?.dateOfBirth,   // ← was missing
        member_id: patientInfo?.memberId,
        group_number: patientInfo?.groupNumber,
        payer_name: patientInfo?.payerName,
        address: patientInfo?.address,
      },
      transcript: fullTranscript,
      healthscribe_summary: results.summary,
      medications: [],
      diagnoses: [],
    });

    onProgress({ step: 'complete', message: 'Complete!', progress: 1.0 });

    return {
      soapNote: soapResult.sections,
      transcript: results.transcript.formatted,
      fullNote: soapResult.full_note,
    };
  } catch (error: any) {
    onProgress({ step: 'error', message: error.message || 'Processing failed', progress: 0 });
    throw error;
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// STAT Consult helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface Specialty {
  id: string;
  name: string;
  icon?: string;
}

export interface ConsultSource {
  title: string;
  url?: string;
  snippet?: string;
  source?: string;
  pmid?: string;
  journal?: string;
  year?: number | string;
}

export interface ConsultMetrics {
  retrievalTime?: number;
  generationTime?: number;
  totalTime?: number;
  chunksRetrieved?: number;
}

export interface StreamClinicalQACallbacks {
  onMetadata?: (
    guidelines: ConsultSource[],
    webSources: ConsultSource[],
    pubmedSources: ConsultSource[],
    metrics: ConsultMetrics,
  ) => void;
  onToken: (text: string) => void;
  onDone: (metrics: ConsultMetrics) => void;
  onError: (err: Error) => void;
}

/** Fetch active specialties from the DB for the specialty picker. */
export async function fetchSpecialties(): Promise<Specialty[]> {
  try {
    const { data, error } = await supabase
      .from('specialties')
      .select('id, name')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return (data ?? []) as Specialty[];
  } catch (e: any) {
    console.warn('[fetchSpecialties]', e?.message);
    return [];
  }
}

/**
 * Stream a clinical Q&A question to the clinical-qa Edge Function.
 * Parses the SSE response and fires typed callbacks.
 * Returns an AbortController so the caller can cancel mid-stream.
 */
export function streamClinicalQA(
  params: {
    question: string;
    specialty_id?: string | null;
    conversation_history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  },
  callbacks: StreamClinicalQACallbacks,
): AbortController {
  const controller = new AbortController();
  const xhr = new XMLHttpRequest();

  controller.signal.addEventListener('abort', () => {
    xhr.abort();
  });

  getAuthHeaders().then(headers => {
    const url = `${getBaseUrl()}/functions/v1/clinical-qa`;

    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    // Very important to ask for text/event-stream so middleware/routers don't buffer it completely
    xhr.setRequestHeader('Accept', 'text/event-stream');

    let seenBytes = 0;
    let buffer = '';

    xhr.onreadystatechange = () => {
      // readyState 3 is LOADING (partial data), 4 is DONE
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        if (xhr.readyState === 4 && xhr.status >= 400 && xhr.status !== 0) {
          let msg = `HTTP ${xhr.status}`;
          try {
            msg = JSON.parse(xhr.responseText)?.error || msg;
          } catch {
            if (xhr.responseText) msg += `: ${xhr.responseText}`;
          }
          callbacks.onError(new Error(msg));
          return;
        }

        const currentText = xhr.responseText || '';
        const newData = currentText.substring(seenBytes);
        seenBytes = currentText.length;

        buffer += newData;

        // SSE events are separated by double newlines
        const events = buffer.split('\n\n');
        // Keep the last (possibly incomplete) chunk in the buffer
        buffer = events.pop() ?? '';

        for (const event of events) {
          const dataLine = event
            .split('\n')
            .find(l => l.startsWith('data:'));
          if (!dataLine) continue;

          const jsonStr = dataLine.slice('data:'.length).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          let parsed: any;
          try { parsed = JSON.parse(jsonStr); } catch { continue; }

          if (parsed.type === 'metadata') {
            callbacks.onMetadata?.(
              parsed.guidelines ?? [],
              parsed.webSources ?? [],
              parsed.pubmedSources ?? [],
              parsed.metrics ?? {},
            );
          } else if (parsed.type === 'content') {
            callbacks.onToken(parsed.text ?? '');
          } else if (parsed.type === 'done') {
            callbacks.onDone(parsed.metrics ?? {});
          } else if (parsed.type === 'error') {
            callbacks.onError(new Error(parsed.message || 'Stream error'));
          }
        }
      }
    };

    xhr.onerror = () => {
      callbacks.onError(new Error('Network error during streaming.'));
    };

    xhr.send(JSON.stringify({
      question: params.question,
      specialty_id: params.specialty_id ?? null,
      stream: true,
      conversation_history: params.conversation_history ?? [],
    }));

  }).catch(err => {
    if (err?.name !== 'AbortError') {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return controller;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patient Data Saving
// ─────────────────────────────────────────────────────────────────────────────

/** Insert a new patient record. Returns the new patient UUID. */
export async function savePatientToSupabase(
  userId: string,
  patientInfo: {
    name?: string;
    dateOfBirth?: string;
    facility?: string;
    memberId?: string;
  },
): Promise<string> {
  // DB requires last_name not null, so fallback if only one name is provided
  const firstName = patientInfo?.name?.split(' ')[0] || 'Unknown';
  const lastName = patientInfo?.name?.split(' ').slice(1).join(' ') || 'Patient';

  const { data, error } = await supabase
    .from('patients')
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      date_of_birth: patientInfo.dateOfBirth || null,
      facility: patientInfo.facility || null,
      prn_mrn: patientInfo.memberId || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save patient: ${error.message}`);
  return data.id;
}

/** Insert a patient encounter. Returns the new encounter UUID. */
export async function saveEncounterToSupabase(
  userId: string,
  patientId: string,
  generatedNote: string,
  session: {
    recordingDuration?: number;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('patient_encounters')
    .insert({
      user_id: userId,
      patient_id: patientId,
      encounter_type: 'progress_note',
      encounter_date: new Date().toISOString().split('T')[0],
      notes: generatedNote,
      is_signed: false,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save encounter: ${error.message}`);
  return data.id;
}

/** Insert a report record. Returns the new report UUID. */
export async function saveReportToSupabase(
  userId: string,
  patientId: string,
  encounterId: string,
  generatedNote: string,
  patientName?: string,
): Promise<string> {
  const title = patientName
    ? `Progress Note - ${patientName}`
    : `Progress Note - ${new Date().toLocaleDateString()}`;

  const { data, error } = await supabase
    .from('reports')
    .insert({
      user_id: userId,
      patient_id: patientId,
      encounter_id: encounterId,
      title,
      final_report: generatedNote,
      template_type: 'soap',
      original_document_name: 'ambient_recording',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save report: ${error.message}`);
  return data.id;
}

/** Insert the ambient session into the cloud ambient_sessions table.
 *  The local session ID is a timestamp string, not a UUID, so we let
 *  Supabase generate a proper UUID. Returns the new cloud session UUID. */
export async function upsertAmbientSession(params: {
  userId: string;
  patientId?: string;
  status: string;
  transcript?: string;
  generatedNote?: string;
  audioS3Uri?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('ambient_sessions')
    .insert({
      // id intentionally omitted — Supabase generates a valid UUID
      user_id: params.userId,
      patient_id: params.patientId || null,
      status: params.status,
      // Wrap generated note, transcript, and audio URI into the JSONB session_data column
      session_data: {
        transcript: params.transcript,
        generated_note: params.generatedNote,
        audio_s3_uri: params.audioS3Uri,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to sync session: ${error.message}`);
  return data.id;
}

/**
 * Call the save-patient-data edge function for structured extraction.
 * Parses vitals, medications, diagnoses, procedures, social/family history
 * from the generated SOAP note.
 */
export async function savePatientData(params: {
  userId: string;
  patientId: string;
  encounterId?: string;
  generatedNote: string;
}): Promise<any> {
  const headers = await getAuthHeaders();

  const response = await fetchWithTimeout(
    `${getBaseUrl()}/functions/v1/save-patient-data`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: params.userId,
        patientId: params.patientId,
        encounterId: params.encounterId || null,
        generatedNote: params.generatedNote,
      }),
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to save patient data: HTTP ${response.status}`);
  }
  return data;
}
