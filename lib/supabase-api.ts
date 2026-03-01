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
