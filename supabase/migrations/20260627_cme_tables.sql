-- CME activity tracking (v1: self-tracked, not ACCME-accredited yet)
-- Also adds cme_tidbits column to freestyle_jobs

ALTER TABLE public.freestyle_jobs
  ADD COLUMN IF NOT EXISTS cme_tidbits jsonb DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.user_cme_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_type text NOT NULL DEFAULT 'md',
  boards text[] NOT NULL DEFAULT '{}',
  cert_cycle_end date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_cme_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_cme_profile_select" ON public.user_cme_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own_cme_profile_insert" ON public.user_cme_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_cme_profile_update" ON public.user_cme_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.cme_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  topic text NOT NULL,
  summary text,
  source_refs jsonb DEFAULT '[]'::jsonb,
  credits_earned numeric(4,2) NOT NULL DEFAULT 0.25,
  attestation_at timestamptz,
  reflection text,
  job_id uuid REFERENCES freestyle_jobs(id) ON DELETE SET NULL,
  consult_message_id text,
  workflow_id text,
  tidbit_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.cme_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_cme_activities_select" ON public.cme_activities
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own_cme_activities_insert" ON public.cme_activities
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cme_activities_user_id ON public.cme_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_cme_activities_created_at ON public.cme_activities(created_at DESC);

-- Realtime for freestyle_jobs (if not already enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'freestyle_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.freestyle_jobs;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
