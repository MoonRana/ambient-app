import type { Session } from '@supabase/supabase-js';
import type { AmbientSession } from '@/lib/session-context';
import type { FreestyleJob } from '@/lib/stores/useJobsStore';

/** Dev-only: populate UI for App Store screenshots. Set EXPO_PUBLIC_SCREENSHOT_DEMO=1 */
export const SCREENSHOT_DEMO = process.env.EXPO_PUBLIC_SCREENSHOT_DEMO === '1';

export const SCREENSHOT_DEMO_SESSION: Session = {
  access_token: 'screenshot-demo',
  refresh_token: 'screenshot-demo',
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'screenshot-demo-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'doctor@clinic.com',
    email_confirmed_at: new Date().toISOString(),
    phone: '',
    confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Dr. Sarah Chen' },
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  },
} as Session;

const now = Date.now();
const hour = 60 * 60 * 1000;

export const SCREENSHOT_DEMO_AMBIENT_SESSIONS: AmbientSession[] = [
  {
    id: 'demo-recording-1',
    createdAt: now - hour,
    updatedAt: now - 5 * 60 * 1000,
    status: 'recording',
    recordingDuration: 312,
    patientInfo: { name: 'James Morrison', dateOfBirth: '1968-04-12' },
    patientContext: 'Follow-up for hypertension and type 2 diabetes.',
    capturedImages: [],
  },
  {
    id: 'demo-completed-1',
    createdAt: now - 3 * hour,
    updatedAt: now - 2 * hour,
    status: 'completed',
    recordingDuration: 847,
    patientInfo: { name: 'Elena Vasquez', dateOfBirth: '1975-09-03', payerName: 'BlueCross' },
    patientContext: 'Annual wellness visit.',
    capturedImages: [],
    transcript: 'Patient reports improved energy. Blood pressure stable at home.',
    soapNote: {
      subjective: 'Patient feels well. No chest pain or shortness of breath.',
      objective: 'BP 128/78, HR 72, lungs clear. A1c 6.9%.',
      assessment: 'Hypertension and T2DM, stable on current regimen.',
      plan: 'Continue lisinopril and metformin. Repeat labs in 3 months.',
      followUp: 'Return in 12 weeks or sooner if symptoms worsen.',
    },
    fullNote: '## SOAP Note\n\n**Subjective:** Patient feels well...\n\n**Plan:** Continue current medications.',
  },
  {
    id: 'demo-processing-1',
    createdAt: now - 30 * 60 * 1000,
    updatedAt: now - 10 * 60 * 1000,
    status: 'processing',
    recordingDuration: 540,
    patientInfo: { name: 'Robert Kim', dateOfBirth: '1982-01-20' },
    capturedImages: [],
  },
  {
    id: 'demo-review-1',
    createdAt: now - 45 * 60 * 1000,
    updatedAt: now - 15 * 60 * 1000,
    status: 'reviewing',
    recordingDuration: 623,
    patientInfo: { name: 'Anita Patel', dateOfBirth: '1990-07-18' },
    transcript: 'Patient presents with persistent cough for two weeks.',
    soapNote: {
      subjective: 'Dry cough, worse at night. No fever.',
      objective: 'Lungs with scattered rhonchi. O2 sat 98%.',
      assessment: 'Likely post-viral bronchitis.',
      plan: 'Supportive care, return if worsening.',
    },
    capturedImages: [],
  },
];

export const SCREENSHOT_DEMO_JOBS: Record<string, FreestyleJob> = {
  'demo-job-1': {
    id: 'demo-job-1',
    workflowId: 'discharge-summary',
    patientName: 'Maria Lopez',
    status: 'generating',
    progress: 68,
    currentStep: 'Drafting clinical summary',
    createdAt: now - 20 * 60 * 1000,
  },
  'demo-job-2': {
    id: 'demo-job-2',
    workflowId: 'prior-auth',
    patientName: 'David Park',
    status: 'complete',
    progress: 100,
    resultNote: 'Prior authorization letter generated with supporting documentation.',
    createdAt: now - 2 * hour,
    completedAt: now - hour,
  },
};

export const SCREENSHOT_DEMO_SESSION_DETAIL_ID = 'demo-completed-1';
