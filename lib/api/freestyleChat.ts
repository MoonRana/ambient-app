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

export interface ChatRequest {
  job_id: string;
  message: string;
  current_note: string;
}

export interface ChatDiff {
  section: string;
  before: string;
  after: string;
}

export interface ChatResponse {
  message_id: string;
  reply: string;
  updated_note: string;
  diff: ChatDiff[];
}

export interface ChatMessage {
  id: string;
  job_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  diff: ChatDiff[] | null;
  applied: boolean;
  created_at: string;
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * Send a chat message to refine a generated note.
 */
export async function sendChatMessage(params: ChatRequest): Promise<ChatResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${getBaseUrl()}/functions/v1/freestyle-chat`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Chat failed: HTTP ${response.status}`);
  }
  return data;
}

/**
 * Fetch chat message history for a job.
 */
export async function getChatHistory(jobId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('freestyle_chat_messages')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch chat history: ${error.message}`);
  return (data || []) as ChatMessage[];
}

/**
 * Mark a chat message's diff as applied (accepted).
 */
export async function applyChatDiff(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('freestyle_chat_messages')
    .update({ applied: true })
    .eq('id', messageId);

  if (error) throw new Error(`Failed to apply diff: ${error.message}`);
}
