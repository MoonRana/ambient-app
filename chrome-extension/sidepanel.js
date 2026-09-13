import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://iunqfdwarvpgrjgjhqaw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1bnFmZHdhcnZwZ3JqZ2pocWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM1MDc3MDIsImV4cCI6MjA2OTA4MzcwMn0.5VdlcDIA3NpqaDq2YM9epEw07nqlRanyG0YdmyWnxdA';

let supabase = null;
let currentSession = null;

// ── Auth ──────────────────────────────────────────────────────────────────────

function buildClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}

async function loadSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || null;
}

async function saveSession(session) {
  await chrome.storage.local.set({ session });
  chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', session });
}

async function clearSession() {
  await chrome.storage.local.remove('session');
  chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', session: null });
}

// ── Login ─────────────────────────────────────────────────────────────────────

document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    errEl.textContent = error?.message || 'Sign in failed. Check your credentials.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }

  await saveSession(data.session);
  showRecordingsView(data.session);
});

document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await clearSession();
  currentSession = null;
  supabase = null;
  showLoginView();
});

// ── Views ─────────────────────────────────────────────────────────────────────

function showLoginView() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('recordings-view').style.display = 'none';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('email').value = '';
  document.getElementById('password').value = '';
}

function showRecordingsView(session) {
  currentSession = session;
  supabase = buildClient(session.access_token);
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('recordings-view').style.display = 'block';
  document.getElementById('user-email-label').textContent = session.user.email;
  chrome.action.setBadgeText({ text: '' });
  loadRecordings();
}

// ── Fetch recordings ──────────────────────────────────────────────────────────

async function loadRecordings() {
  const list = document.getElementById('recordings-list');
  list.innerHTML = '<div class="state-msg"><div class="spinner"></div>Loading recordings…</div>';

  try {
    const [freestyleRes, ambientRes] = await Promise.all([
      supabase
        .from('freestyle_jobs')
        .select('id, status, result_note, cme_tidbits, created_at, completed_at, inputs, patient_id, patients(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('ambient_sessions')
        .select('id, status, session_data, created_at, patient_id, patients(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const freestyle = (freestyleRes.data || []).map((r) => ({
      id: r.id,
      type: 'freestyle',
      status: r.status,
      note: r.result_note,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      patientName: r.patients ? `${r.patients.first_name || ''} ${r.patients.last_name || ''}`.trim() : null,
      duration: null,
    }));

    const ambient = (ambientRes.data || []).map((r) => {
      const sd = r.session_data || {};
      const note = sd.soap_note
        ? [
            sd.soap_note.subjective ? `SUBJECTIVE:\n${sd.soap_note.subjective}` : '',
            sd.soap_note.objective ? `\nOBJECTIVE:\n${sd.soap_note.objective}` : '',
            sd.soap_note.assessment ? `\nASSESSMENT:\n${sd.soap_note.assessment}` : '',
            sd.soap_note.plan ? `\nPLAN:\n${sd.soap_note.plan}` : '',
          ].filter(Boolean).join('\n')
        : null;
      return {
        id: r.id,
        type: 'ambient',
        status: r.status === 'completed' ? 'complete' : r.status,
        note,
        createdAt: r.created_at,
        completedAt: r.created_at,
        patientName: r.patients ? `${r.patients.first_name || ''} ${r.patients.last_name || ''}`.trim() : null,
        duration: sd.recording_duration || null,
      };
    });

    const combined = [...freestyle, ...ambient].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    ).slice(0, 15);

    renderRecordings(combined);
  } catch (e) {
    list.innerHTML = `<div class="state-msg"><span class="icon">⚠️</span>${e.message || 'Failed to load recordings.'}</div>`;
  }
}

function renderRecordings(items) {
  const list = document.getElementById('recordings-list');

  if (items.length === 0) {
    list.innerHTML = '<div class="state-msg"><span class="icon">🎙️</span>No recordings yet.<br>Complete an encounter in the DoMyNote app.</div>';
    return;
  }

  list.innerHTML = items.map((item, i) => buildCard(item, i)).join('');

  list.querySelectorAll('.card-header').forEach((header) => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.copy-btn')) return;
      const card = header.closest('.recording-card');
      const content = card.querySelector('.note-content');
      const chevron = header.querySelector('.chevron');
      const isOpen = content.classList.contains('visible');
      content.classList.toggle('visible', !isOpen);
      chevron.classList.toggle('open', !isOpen);
    });
  });

  list.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const note = btn.dataset.note;
      if (!note) return;
      await navigator.clipboard.writeText(note);
      btn.textContent = '✓ Copied';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy Note';
        btn.classList.remove('copied');
      }, 2000);
    });
  });
}

function buildCard(item, index) {
  const isNew = index === 0;
  const date = new Date(item.createdAt);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const duration = item.duration ? formatDuration(item.duration) : '';
  const patientName = item.patientName || 'Unknown Patient';
  const hasNote = !!item.note;
  const noteEsc = item.note ? escapeHtml(item.note) : '';
  const statusBadge = item.status === 'complete'
    ? '<span class="badge badge-complete">Complete</span>'
    : '<span class="badge badge-processing">Processing</span>';
  const typeBadge = item.type === 'freestyle'
    ? '<span class="badge badge-freestyle">H&amp;P</span>'
    : '<span class="badge badge-ambient">Recorded</span>';

  return `
    <div class="recording-card${isNew ? ' new' : ''}">
      <div class="card-header">
        <div class="card-meta">
          <div class="patient-name">${escapeHtml(patientName)}</div>
          <div class="card-details">
            <span>${dateStr} ${timeStr}</span>
            ${duration ? `<span>🎙 ${duration}</span>` : ''}
            ${statusBadge}
            ${typeBadge}
          </div>
        </div>
        <div class="card-actions">
          ${hasNote ? `<button class="copy-btn" data-note="${escapeAttr(item.note)}">Copy Note</button>` : ''}
          ${hasNote ? '<span class="chevron">▼</span>' : ''}
        </div>
      </div>
      ${hasNote ? `
        <div class="note-content">
          <div class="note-text">${noteEsc}</div>
        </div>
      ` : ''}
    </div>`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Realtime updates from background ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'NEW_RECORDING' && currentSession) {
    loadRecordings();
    chrome.action.setBadgeText({ text: '' });
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  const session = await loadSession();
  if (session?.access_token) {
    showRecordingsView(session);
  } else {
    showLoginView();
  }
})();
