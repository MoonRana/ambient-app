/** CME credit amounts and copy — v1 self-tracked only. */

export const CME_DISCLAIMER =
  'Activity logged for your records. Not ACCME Category 1 credit until formally accredited.';

export const CME_CREDITS = {
  consult_search: 0.5,
  note_tidbit: 0.25,
} as const;

export const CME_MAX_PER_ENCOUNTER = 1.0;

export type CredentialType = 'md' | 'np' | 'pa';
export type CmeBoard = 'abim' | 'abfm' | 'ancc' | 'nccpa';

export const CREDENTIAL_OPTIONS: Array<{ id: CredentialType; label: string }> = [
  { id: 'md', label: 'Physician (MD/DO)' },
  { id: 'np', label: 'Nurse Practitioner' },
  { id: 'pa', label: 'Physician Assistant' },
];

export const BOARD_OPTIONS: Array<{ id: CmeBoard; label: string; forCredential: CredentialType[] }> = [
  { id: 'abim', label: 'ABIM (Internal Medicine MOC)', forCredential: ['md'] },
  { id: 'abfm', label: 'ABFM (Family Medicine MC-FP)', forCredential: ['md'] },
  { id: 'ancc', label: 'ANCC / AANP contact hours', forCredential: ['np'] },
  { id: 'nccpa', label: 'NCCPA Category 1 CME', forCredential: ['pa'] },
];

export type CmeActivityType = 'consult_search' | 'note_tidbit';

export interface CmeActivityRow {
  id: string;
  user_id: string;
  activity_type: CmeActivityType;
  topic: string;
  summary: string | null;
  source_refs: unknown;
  credits_earned: number;
  attestation_at: string | null;
  reflection: string | null;
  job_id: string | null;
  consult_message_id: string | null;
  workflow_id: string | null;
  tidbit_id: string | null;
  created_at: string;
}

export interface CmeProfileRow {
  user_id: string;
  credential_type: CredentialType;
  boards: string[];
  cert_cycle_end: string | null;
}

export interface CmeTidbit {
  id: string;
  topic: string;
  body: string;
}
