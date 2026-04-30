-- ============================================================================
-- DoMyNote Freestyle Workflow — Database Migration
-- ============================================================================

-- 1. freestyle_jobs — tracks background H&P generation jobs
CREATE TABLE IF NOT EXISTS public.freestyle_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  patient_id uuid REFERENCES patients(id),
  status text NOT NULL DEFAULT 'queued',
  progress int NOT NULL DEFAULT 0,
  current_step text,
  inputs jsonb NOT NULL DEFAULT '{}',
  result_note text,
  error text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.freestyle_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_jobs_select" ON public.freestyle_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own_jobs_insert" ON public.freestyle_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_jobs_update" ON public.freestyle_jobs
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_jobs_delete" ON public.freestyle_jobs
  FOR DELETE USING (auth.uid() = user_id);

-- Index for listing user's jobs
CREATE INDEX IF NOT EXISTS idx_freestyle_jobs_user_id ON public.freestyle_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_freestyle_jobs_status ON public.freestyle_jobs(status);

-- 2. patient_workflows — multiple parallel workflows per patient
CREATE TABLE IF NOT EXISTS public.patient_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  workflow_type text NOT NULL,         -- 'freestyle' | 'document' | 'ambient' | 'quicknote'
  status text NOT NULL DEFAULT 'active',
  freestyle_job_id uuid REFERENCES freestyle_jobs(id),
  ambient_session_id uuid REFERENCES ambient_sessions(id),
  label text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.patient_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_workflows_select" ON public.patient_workflows
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own_workflows_insert" ON public.patient_workflows
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_workflows_update" ON public.patient_workflows
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_workflows_delete" ON public.patient_workflows
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_patient_workflows_patient_id ON public.patient_workflows(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_workflows_user_id ON public.patient_workflows(user_id);

-- 3. freestyle_chat_messages — chat refinement messages for generated notes
CREATE TABLE IF NOT EXISTS public.freestyle_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES freestyle_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL,                  -- 'user' | 'assistant'
  content text NOT NULL,
  diff jsonb,
  applied boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.freestyle_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_chat_select" ON public.freestyle_chat_messages
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own_chat_insert" ON public.freestyle_chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_chat_update" ON public.freestyle_chat_messages
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_freestyle_chat_job_id ON public.freestyle_chat_messages(job_id);

-- 4. Enable Realtime for job progress and chat updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.freestyle_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.freestyle_chat_messages;
