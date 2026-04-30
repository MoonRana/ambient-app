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

// ── Types ────────────────────────────────────────────────────────────────────

export type AssistMode = 'chat' | 'recommend';

export interface AssistRecommendation {
  type: 'diagnosis' | 'interaction' | 'missing_data' | 'icd10_code';
  text: string;
  confidence?: number;
  severity?: 'none' | 'low' | 'moderate' | 'high' | 'critical';
}

export interface AssistSource {
  title: string;
  snippet?: string;
}

export interface AssistContext {
  notes: string;
  medications: Array<{ name: string; dose?: string; frequency?: string }>;
  document_summaries: string[];
  recording_transcripts: string[];
  patient_info?: {
    age?: string;
    sex?: string;
    chief_complaint?: string;
  };
}

export interface AssistRequest {
  mode: AssistMode;
  message: string;
  workflow_id?: string;
  session_key: string;
  context: AssistContext;
  conversation_history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AssistResponse {
  message_id: string;
  reply: string;
  recommendations: AssistRecommendation[];
  sources: AssistSource[];
}

export interface AssistMessage {
  id: string;
  user_id: string;
  workflow_id: string | null;
  session_key: string;
  mode: AssistMode;
  role: 'user' | 'assistant';
  content: string;
  recommendations: AssistRecommendation[] | null;
  sources: AssistSource[] | null;
  created_at: string;
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * Send a message to the freestyle-assist AI companion.
 * Works in two modes:
 *   - chat: conversational Q&A about the patient / clinical context
 *   - recommend: structured recommendations (diagnoses, interactions, missing data, ICD-10)
 */
export async function sendAssistMessage(params: AssistRequest): Promise<AssistResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${getBaseUrl()}/functions/v1/freestyle-assist`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    if (response.status === 429) {
      throw new Error('Rate limit reached. Please wait a moment and try again.');
    }
    if (response.status === 402) {
      throw new Error('AI credits exhausted. Contact support.');
    }

    throw new Error(data.error || `Assist failed: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get auto-recommendations based on current workspace context.
 * Convenience wrapper around sendAssistMessage with mode='recommend'.
 */
export async function getRecommendations(
  context: AssistContext,
  sessionKey: string,
  workflowId?: string,
): Promise<AssistResponse> {
  return sendAssistMessage({
    mode: 'recommend',
    message: 'Analyze the current workspace and provide clinical recommendations.',
    session_key: sessionKey,
    workflow_id: workflowId,
    context,
    conversation_history: [],
  });
}

/**
 * Fetch assist chat history for a session.
 */
export async function getAssistHistory(sessionKey: string): Promise<AssistMessage[]> {
  const { data, error } = await supabase
    .from('freestyle_assist_messages')
    .select('*')
    .eq('session_key', sessionKey)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch assist history: ${error.message}`);
  return (data || []) as AssistMessage[];
}
