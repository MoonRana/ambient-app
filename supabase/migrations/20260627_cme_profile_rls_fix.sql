-- Fix CME profile RLS for insert/update from mobile clients

DROP POLICY IF EXISTS "own_cme_profile_select" ON public.user_cme_profiles;
DROP POLICY IF EXISTS "own_cme_profile_insert" ON public.user_cme_profiles;
DROP POLICY IF EXISTS "own_cme_profile_update" ON public.user_cme_profiles;

CREATE POLICY "own_cme_profile_select" ON public.user_cme_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own_cme_profile_insert" ON public.user_cme_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_cme_profile_update" ON public.user_cme_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_cme_profiles TO authenticated;
GRANT SELECT, INSERT ON public.cme_activities TO authenticated;
