import { supabase } from '@/lib/supabase';
import {
  type CmeActivityRow,
  type CmeActivityType,
  type CmeProfileRow,
  type CredentialType,
  type CmeBoard,
  CME_CREDITS,
} from './cme-config';

export async function fetchCmeProfile(): Promise<CmeProfileRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_cme_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[fetchCmeProfile]', error.message);
    return null;
  }
  return data as CmeProfileRow | null;
}

function formatDbError(error: { message?: string; details?: string; hint?: string; code?: string }): string {
  return (
    error.message ||
    error.details ||
    error.hint ||
    (error.code ? `Database error (${error.code})` : '') ||
    'Could not save CME profile'
  );
}

export async function upsertCmeProfile(params: {
  credential_type: CredentialType;
  boards: CmeBoard[];
  cert_cycle_end?: string | null;
}): Promise<void> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const user = session?.user;
  if (!user) throw new Error('Sign in to save your CME profile.');

  const payload = {
    credential_type: params.credential_type,
    boards: params.boards,
    cert_cycle_end: params.cert_cycle_end ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await supabase
    .from('user_cme_profiles')
    .update(payload)
    .eq('user_id', user.id)
    .select('user_id');

  if (updateError) throw new Error(formatDbError(updateError));

  if (!updated?.length) {
    const { error: insertError } = await supabase.from('user_cme_profiles').insert({
      user_id: user.id,
      ...payload,
    });
    if (insertError) throw new Error(formatDbError(insertError));
  }
}

export async function logCmeActivity(params: {
  activity_type: CmeActivityType;
  topic: string;
  summary?: string;
  source_refs?: unknown[];
  credits_earned?: number;
  job_id?: string;
  consult_message_id?: string;
  workflow_id?: string;
  tidbit_id?: string;
  reflection?: string;
}): Promise<CmeActivityRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const credits = params.credits_earned ?? CME_CREDITS[params.activity_type];

  const { data, error } = await supabase
    .from('cme_activities')
    .insert({
      user_id: user.id,
      activity_type: params.activity_type,
      topic: params.topic.slice(0, 500),
      summary: params.summary?.slice(0, 2000) ?? null,
      source_refs: params.source_refs ?? [],
      credits_earned: credits,
      attestation_at: new Date().toISOString(),
      reflection: params.reflection ?? null,
      job_id: params.job_id ?? null,
      consult_message_id: params.consult_message_id ?? null,
      workflow_id: params.workflow_id ?? null,
      tidbit_id: params.tidbit_id ?? null,
    })
    .select('*')
    .single();

  if (error) {
    console.warn('[logCmeActivity]', error.message);
    return null;
  }
  return data as CmeActivityRow;
}

export async function fetchCmeActivities(limit = 100): Promise<CmeActivityRow[]> {
  const { data, error } = await supabase
    .from('cme_activities')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[fetchCmeActivities]', error.message);
    return [];
  }
  return (data || []) as CmeActivityRow[];
}

export async function fetchCmeTotals(): Promise<{ total: number; thisMonth: number }> {
  const activities = await fetchCmeActivities(500);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let total = 0;
  let thisMonth = 0;
  for (const a of activities) {
    const cr = Number(a.credits_earned) || 0;
    total += cr;
    if (new Date(a.created_at) >= monthStart) {
      thisMonth += cr;
    }
  }
  return { total, thisMonth };
}

export async function hasClaimedTidbit(jobId: string, tidbitId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('cme_activities')
    .select('id')
    .eq('job_id', jobId)
    .eq('tidbit_id', tidbitId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export async function hasClaimedConsultMessage(messageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('cme_activities')
    .select('id')
    .eq('consult_message_id', messageId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export function buildCmeCsv(activities: CmeActivityRow[]): string {
  const header = 'Date,Type,Topic,Credits,Summary';
  const rows = activities.map((a) => {
    const date = new Date(a.created_at).toISOString().slice(0, 10);
    const topic = `"${(a.topic || '').replace(/"/g, '""')}"`;
    const summary = `"${(a.summary || '').replace(/"/g, '""')}"`;
    return `${date},${a.activity_type},${topic},${a.credits_earned},${summary}`;
  });
  return [header, ...rows].join('\n');
}

export function buildCmeCertificateText(
  activities: CmeActivityRow[],
  profile: CmeProfileRow | null,
): string {
  const total = activities.reduce((s, a) => s + (Number(a.credits_earned) || 0), 0);
  const lines = [
    'DoMyNote — CME Activity Certificate (Self-Tracked)',
    '==================================================',
    '',
    `Credential: ${profile?.credential_type?.toUpperCase() ?? 'Not set'}`,
    `Boards: ${(profile?.boards || []).join(', ') || 'Not set'}`,
    `Total credits logged: ${total.toFixed(2)} hours`,
    `Activities: ${activities.length}`,
    `Generated: ${new Date().toLocaleDateString()}`,
    '',
    'DISCLAIMER: Activity logged for your records.',
    'Not ACCME Category 1 credit until formally accredited.',
    '',
    '--- Activity Log ---',
  ];
  for (const a of activities.slice(0, 50)) {
    lines.push(
      `${new Date(a.created_at).toLocaleDateString()} | ${a.credits_earned} hr | ${a.topic}`,
    );
  }
  return lines.join('\n');
}
