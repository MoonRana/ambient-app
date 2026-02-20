import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const POLLING_INTERVAL = 5000;
const MAX_ATTEMPTS = 60;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_SUPABASE_URL || '';
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

  const response = await fetch(`${getBaseUrl()}/functions/v1/upload-audio-to-s3`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      audio_base64: audioBase64,
      content_type: contentType,
      session_id: sessionId,
    }),
  });

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

  const response = await fetch(`${getBaseUrl()}/functions/v1/start-healthscribe-job`, {
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

  const response = await fetch(`${getBaseUrl()}/functions/v1/get-healthscribe-status`, {
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

  const response = await fetch(`${getBaseUrl()}/functions/v1/fetch-healthscribe-results`, {
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

  const response = await fetch(`${getBaseUrl()}/functions/v1/generate-soap-note`, {
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
      await sleep(POLLING_INTERVAL);
      status = await getHealthScribeStatus(job.job_name);
      attempts++;

      const pollProgress = Math.min(0.3 + (attempts / MAX_ATTEMPTS) * 0.4, 0.7);
      onProgress({
        step: 'processing',
        message: status.status === 'IN_PROGRESS' ? 'Processing transcription...' : 'Waiting in queue...',
        progress: pollProgress,
      });
    }

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

    const soapResult = await generateSOAPNote({
      session_id: sessionId,
      patient_info: patientContext ? { name: patientContext } : undefined,
      transcript: results.transcript.formatted,
      healthscribe_summary: results.summary,
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
