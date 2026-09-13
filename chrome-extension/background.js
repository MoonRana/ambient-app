import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://iunqfdwarvpgrjgjhqaw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1bnFmZHdhcnZwZ3JqZ2pocWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM1MDc3MDIsImV4cCI6MjA2OTA4MzcwMn0.5VdlcDIA3NpqaDq2YM9epEw07nqlRanyG0YdmyWnxdA';

let supabase = null;
let realtimeChannel = null;

function getSupabase(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}

async function subscribeRealtime(session) {
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }

  supabase = getSupabase(session.access_token);

  realtimeChannel = supabase
    .channel('domynote_recordings')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'freestyle_jobs',
      filter: `user_id=eq.${session.user.id}`,
    }, (payload) => {
      if (payload.new?.status === 'complete') {
        notifyNewRecording();
      }
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'ambient_sessions',
      filter: `user_id=eq.${session.user.id}`,
    }, (payload) => {
      const sessionData = payload.new?.session_data;
      if (sessionData?.local_status === 'completed' || payload.new?.status === 'completed') {
        notifyNewRecording();
      }
    })
    .subscribe();
}

function notifyNewRecording() {
  chrome.action.setBadgeText({ text: '●' });
  chrome.action.setBadgeBackgroundColor({ color: '#1a7fa8' });
  chrome.runtime.sendMessage({ type: 'NEW_RECORDING' }).catch(() => {});
}

async function init() {
  const { session } = await chrome.storage.local.get('session');
  if (session?.access_token) {
    await subscribeRealtime(session);
  }
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SESSION_UPDATED') {
    if (msg.session) {
      subscribeRealtime(msg.session).then(() => sendResponse({ ok: true }));
    } else {
      if (realtimeChannel) realtimeChannel.unsubscribe();
      realtimeChannel = null;
      supabase = null;
      sendResponse({ ok: true });
    }
    return true;
  }
  if (msg.type === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
  }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
