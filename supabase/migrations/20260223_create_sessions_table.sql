-- Create sessions table for ClinicalDoc AI
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

create table if not exists public.sessions (
  -- Identity
  id                text primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,

  -- Timestamps
  created_at        timestamptz not null,
  updated_at        timestamptz not null,

  -- Session state
  status            text not null default 'recording',
  recording_duration integer not null default 0,
  patient_context   text,
  error_message     text,

  -- Patient info (flattened from patientInfo object)
  patient_name      text,
  patient_dob       text,
  patient_address   text,
  member_id         text,
  group_number      text,
  payer_name        text,

  -- SOAP note sections
  soap_subjective   text,
  soap_objective    text,
  soap_assessment   text,
  soap_plan         text,
  soap_follow_up    text,
  full_note         text,
  transcript        text
);

-- Index for fast user queries
create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists sessions_updated_at_idx on public.sessions(updated_at desc);

-- Enable Row Level Security
alter table public.sessions enable row level security;

-- RLS Policies: users can only see/edit their own sessions
create policy "Users can view own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.sessions for update
  using (auth.uid() = user_id);

create policy "Users can delete own sessions"
  on public.sessions for delete
  using (auth.uid() = user_id);
