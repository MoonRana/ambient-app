// ============================================================================
// BATCH 15 — shared authentication helper.
// PHI-handling edge functions must never accept an anonymous caller and must
// never trust a user id from the request body. Identity comes from the verified
// JWT only. Returns a REQUEST-SCOPED Supabase client that carries the caller's
// JWT so RLS applies to every query made with it.
// ============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export interface AuthedCaller {
  userId: string;
  email: string | null;
  /** Request-scoped client — RLS applies. Use this for all data access. */
  db: SupabaseClient;
  /** Raw bearer token, for forwarding to other authenticated functions. */
  token: string;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * Verify the Authorization bearer token. Throws AuthError when missing or invalid.
 * There is deliberately no anonymous fallback and no `userId` body parameter.
 */
export async function requireUser(req: Request): Promise<AuthedCaller> {
  const header = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!header || !/^Bearer\s+.+/i.test(header)) {
    throw new AuthError('Authentication required');
  }
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new AuthError('Authentication required');

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new AuthError('Auth is not configured', 500);

  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new AuthError('Invalid or expired session');

  return { userId: data.user.id, email: data.user.email ?? null, db, token };
}

/** Standard 401/403 response for a caught AuthError. */
export function authErrorResponse(error: unknown, corsHeaders: Record<string, string>): Response {
  const status = error instanceof AuthError ? error.status : 401;
  const message = error instanceof AuthError ? error.message : 'Authentication required';
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
