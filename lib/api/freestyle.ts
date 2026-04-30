import { supabase } from '@/lib/supabase';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthHeaders() {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || anonKey;
  return {
    'Authorization': `Bearer ${token}`,
    'apikey': anonKey,
    'Content-Type': 'application/json',
  };
}

function getBaseUrl() {
  return (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
}

async function fetchWithTimeout(url: string, options: any, timeout = 120000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your internet connection and try again.');
    }
    throw new Error(`Network request failed: ${error.message || 'Unknown error'}.`);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface FreestyleGenerateRequest {
  patient_id: string | null;
  documents: Array<{
    storage_path: string;
    type: 'pdf' | 'image';
    name: string;
  }>;
  recordings: Array<{
    storage_path: string;
    transcript?: string;
    duration_s: number;
  }>;
  notes: string;
  medications: Array<{
    medication_name: string;
    dosage?: string;
    frequency?: string;
  }>;
}

export interface FreestyleGenerateResponse {
  job_id: string;
  status: 'queued';
}

export interface FreestyleJobRow {
  id: string;
  user_id: string;
  patient_id: string | null;
  status: string;
  progress: number;
  current_step: string | null;
  inputs: any;
  result_note: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * Kick off background H&P generation.
 * Returns a job_id within <1s — the actual work happens asynchronously.
 */
export async function generateFreestyle(
  payload: FreestyleGenerateRequest,
): Promise<FreestyleGenerateResponse> {
  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(
    `${getBaseUrl()}/functions/v1/freestyle-generate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    10000, // 10s — should return in <1s
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to start generation: HTTP ${response.status}`);
  }
  return data;
}

/**
 * Fetch a single job's current state.
 */
export async function getJobStatus(jobId: string): Promise<FreestyleJobRow> {
  const { data, error } = await supabase
    .from('freestyle_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) throw new Error(`Failed to fetch job: ${error.message}`);
  return data as FreestyleJobRow;
}

/**
 * List recent jobs for the current user.
 */
export async function listJobs(limit = 50): Promise<FreestyleJobRow[]> {
  const { data, error } = await supabase
    .from('freestyle_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list jobs: ${error.message}`);
  return (data || []) as FreestyleJobRow[];
}

/**
 * Create a patient_workflow row.
 */
export async function createPatientWorkflow(params: {
  patientId: string;
  userId: string;
  workflowType: 'freestyle' | 'document' | 'ambient' | 'quicknote';
  freestyleJobId?: string;
  label?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('patient_workflows')
    .insert({
      patient_id: params.patientId,
      user_id: params.userId,
      workflow_type: params.workflowType,
      freestyle_job_id: params.freestyleJobId || null,
      label: params.label || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create workflow: ${error.message}`);
  return data.id;
}

/**
 * List workflows for a specific patient.
 */
export async function listPatientWorkflows(patientId: string) {
  const { data, error } = await supabase
    .from('patient_workflows')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list workflows: ${error.message}`);
  return data || [];
}
