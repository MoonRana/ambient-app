/**
 * Roadmap feature smoke tests (Speed, CME, Jobs realtime).
 * Run: npx tsx scripts/test-roadmap.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const k = line.slice(0, eqIdx).trim();
    const v = line.slice(eqIdx + 1).trim();
    if (k) process.env[k] = v;
  }
}

const BASE = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let passed = 0;
let failed = 0;

async function test(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅  ${label}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ❌  ${label}`);
    console.log(`       → ${msg}`);
    failed++;
  }
}

async function main() {
  console.log('\n── Roadmap: CME schema ──');
  for (const table of ['user_cme_profiles', 'cme_activities']) {
    await test(`table ${table} exists`, async () => {
      const r = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=0`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status}: ${t.slice(0, 120)}`);
      }
    });
  }

  await test('freestyle_jobs.cme_tidbits column', async () => {
    const r = await fetch(`${BASE}/rest/v1/freestyle_jobs?select=cme_tidbits&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`${r.status}: ${t.slice(0, 120)}`);
    }
  });

  console.log('\n── Roadmap: CME config ──');
  const { CME_CREDITS, CME_DISCLAIMER, CREDENTIAL_OPTIONS } = await import('../lib/cme/cme-config');
  await test('CME credit amounts', async () => {
    if (CME_CREDITS.consult_search !== 0.5) throw new Error('consult_search should be 0.5');
    if (CME_CREDITS.note_tidbit !== 0.25) throw new Error('note_tidbit should be 0.25');
    if (!CME_DISCLAIMER.includes('ACCME')) throw new Error('disclaimer missing ACCME note');
    if (CREDENTIAL_OPTIONS.length < 3) throw new Error('credential options missing');
  });

  console.log('\n── Roadmap: Source files wired ──');
  const required = [
    'lib/hooks/useFreestyleGeneration.ts',
    'lib/hooks/useJobRealtime.ts',
    'components/cme/CmeClaimChip.tsx',
    'components/cme/CmeTidbitsPanel.tsx',
    'supabase/functions/freestyle-generate/index.ts',
    'supabase/migrations/20260627_cme_tables.sql',
    'docs/cme-accreditation.md',
  ];
  for (const f of required) {
    await test(`${f} exists`, async () => {
      if (!fs.existsSync(path.resolve(__dirname, '..', f))) throw new Error('missing');
    });
  }

  console.log('\n── Roadmap: useFreestyleGeneration parallel uploads ──');
  const genSrc = fs.readFileSync(
    path.resolve(__dirname, '../lib/hooks/useFreestyleGeneration.ts'),
    'utf8',
  );
  await test('Promise.all for parallel uploads', async () => {
    if (!genSrc.includes('Promise.all') || !genSrc.includes('workflow.documents.map'))
      throw new Error('parallel uploads not found');
  });
  await test('1200px image compress', async () => {
    if (!genSrc.includes('1200') || !genSrc.includes('0.65'))
      throw new Error('image size/compress settings not found');
  });
  await test('passes existing transcript', async () => {
    if (!genSrc.includes('transcript')) throw new Error('transcript passthrough not found');
  });

  console.log('\n── Roadmap: freestyle-generate server ──');
  const srvSrc = fs.readFileSync(
    path.resolve(__dirname, '../supabase/functions/freestyle-generate/index.ts'),
    'utf8',
  );
  await test('parallel extract (Promise.all)', async () => {
    if (!srvSrc.includes('Promise.all')) throw new Error('Promise.all not in server');
  });
  await test('gpt-4o-mini OCR fast path', async () => {
    if (!srvSrc.includes('gpt-4o-mini')) throw new Error('fast OCR model not found');
  });
  await test('CME tidbits generation', async () => {
    if (!srvSrc.includes('generateCmeTidbits') && !srvSrc.includes('cme_tidbits'))
      throw new Error('tidbits generation not found');
  });

  console.log(`\n══════════════════════════════════════`);
  console.log(`  RESULTS: ${passed} passed | ${failed} failed`);
  console.log(`══════════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
