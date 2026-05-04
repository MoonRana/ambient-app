-- ============================================================================
-- Fix Storage Buckets & RLS Policies for Freestyle Uploads
-- ============================================================================

-- 1. Create storage buckets if they don't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('freestyle-documents', 'freestyle-documents', false, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('freestyle-recordings', 'freestyle-recordings', false, 104857600, ARRAY['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/aac', 'audio/x-m4a'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage RLS policies — users can CRUD their own files under freestyle/{user_id}/*

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "freestyle_docs_select" ON storage.objects;
DROP POLICY IF EXISTS "freestyle_docs_insert" ON storage.objects;
DROP POLICY IF EXISTS "freestyle_docs_update" ON storage.objects;
DROP POLICY IF EXISTS "freestyle_docs_delete" ON storage.objects;
DROP POLICY IF EXISTS "freestyle_recs_select" ON storage.objects;
DROP POLICY IF EXISTS "freestyle_recs_insert" ON storage.objects;
DROP POLICY IF EXISTS "freestyle_recs_update" ON storage.objects;
DROP POLICY IF EXISTS "freestyle_recs_delete" ON storage.objects;

-- Documents bucket
CREATE POLICY "freestyle_docs_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'freestyle-documents'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "freestyle_docs_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'freestyle-documents'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "freestyle_docs_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'freestyle-documents'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "freestyle_docs_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'freestyle-documents'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Recordings bucket
CREATE POLICY "freestyle_recs_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'freestyle-recordings'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "freestyle_recs_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'freestyle-recordings'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "freestyle_recs_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'freestyle-recordings'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "freestyle_recs_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'freestyle-recordings'
    AND (storage.foldername(name))[1] = 'freestyle'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
