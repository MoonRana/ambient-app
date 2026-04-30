import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ────────────────────────────────────────────────────────────────────

export type RecordingState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'stopped'
  | 'uploading'
  | 'transcribed'
  | 'retry_pending';

export interface DocumentInput {
  id: string;
  uri: string;
  name: string;
  type: 'pdf' | 'image';
  sizeBytes: number;
  thumbnailUri?: string;
  storagePath?: string; // set after upload to Supabase Storage
  addedAt: number;
}

export interface RecordingInput {
  id: string;
  state: RecordingState;
  uri?: string;           // filesystem URI for the audio file
  duration: number;       // seconds elapsed
  transcript?: string;    // set after transcription
  storagePath?: string;   // set after upload
  label?: string;         // e.g., "HPI from patient", "ROS from nurse"
  startedAt?: number;
  stoppedAt?: number;
}

export interface MedicationInput {
  id: string;
  name: string;
  dose?: string;
  frequency?: string;
  route?: string;
  notes?: string;
}

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'failed';

export interface FreestyleWorkflow {
  workflowId: string;
  patientId: string | null;
  patientInfo?: {
    name?: string;
    dateOfBirth?: string;
    memberId?: string;
    groupNumber?: string;
    payerName?: string;
    address?: string;
  };
  documents: DocumentInput[];
  recordings: RecordingInput[];
  notes: string;
  medications: MedicationInput[];
  createdAt: number;
  updatedAt: number;
  syncStatus: SyncStatus;
  jobId: string | null;     // set after generation kicked off
}

// ── Store Interface ──────────────────────────────────────────────────────────

interface FreestyleStore {
  workflows: Record<string, FreestyleWorkflow>;
  activeWorkflowId: string | null;
  _hasHydrated: boolean;

  // Workflow CRUD
  createWorkflow: () => string;
  deleteWorkflow: (workflowId: string) => void;
  setActiveWorkflow: (workflowId: string | null) => void;
  getActiveWorkflow: () => FreestyleWorkflow | null;

  // Documents
  addDocument: (workflowId: string, doc: Omit<DocumentInput, 'id' | 'addedAt'>) => void;
  removeDocument: (workflowId: string, docId: string) => void;

  // Recordings
  addRecording: (workflowId: string) => string;
  updateRecording: (workflowId: string, recordingId: string, patch: Partial<RecordingInput>) => void;
  removeRecording: (workflowId: string, recordingId: string) => void;

  // Notes
  setNotes: (workflowId: string, notes: string) => void;

  // Medications
  addMedication: (workflowId: string, med: Omit<MedicationInput, 'id'>) => void;
  removeMedication: (workflowId: string, medId: string) => void;

  // Patient
  setPatientId: (workflowId: string, patientId: string | null) => void;
  setPatientInfo: (workflowId: string, info: FreestyleWorkflow['patientInfo']) => void;

  // Generation
  setJobId: (workflowId: string, jobId: string) => void;
  setSyncStatus: (workflowId: string, status: SyncStatus) => void;

  // Hydration
  setHasHydrated: (state: boolean) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function patchWorkflow(
  state: FreestyleStore,
  workflowId: string,
  patch: Partial<FreestyleWorkflow>,
): Partial<FreestyleStore> {
  const wf = state.workflows[workflowId];
  if (!wf) return {};
  return {
    workflows: {
      ...state.workflows,
      [workflowId]: { ...wf, ...patch, updatedAt: Date.now() },
    },
  };
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useFreestyleStore = create<FreestyleStore>()(
  persist(
    (set, get) => ({
      workflows: {},
      activeWorkflowId: null,
      _hasHydrated: false,

      setHasHydrated: (state) => set({ _hasHydrated: state }),

      // ── Workflow CRUD ────────────────────────────────────────────────
      createWorkflow: () => {
        const id = generateId();
        const now = Date.now();
        const workflow: FreestyleWorkflow = {
          workflowId: id,
          patientId: null,
          documents: [],
          recordings: [],
          notes: '',
          medications: [],
          createdAt: now,
          updatedAt: now,
          syncStatus: 'local',
          jobId: null,
        };
        set((state) => ({
          workflows: { ...state.workflows, [id]: workflow },
          activeWorkflowId: id,
        }));
        return id;
      },

      deleteWorkflow: (workflowId) => {
        set((state) => {
          const { [workflowId]: _, ...rest } = state.workflows;
          return {
            workflows: rest,
            activeWorkflowId:
              state.activeWorkflowId === workflowId ? null : state.activeWorkflowId,
          };
        });
      },

      setActiveWorkflow: (workflowId) => set({ activeWorkflowId: workflowId }),

      getActiveWorkflow: () => {
        const { workflows, activeWorkflowId } = get();
        if (!activeWorkflowId) return null;
        return workflows[activeWorkflowId] ?? null;
      },

      // ── Documents ────────────────────────────────────────────────────
      addDocument: (workflowId, doc) => {
        set((state) => {
          const wf = state.workflows[workflowId];
          if (!wf) return {};
          const newDoc: DocumentInput = {
            ...doc,
            id: generateId(),
            addedAt: Date.now(),
          };
          return patchWorkflow(state, workflowId, {
            documents: [...wf.documents, newDoc],
          });
        });
      },

      removeDocument: (workflowId, docId) => {
        set((state) => {
          const wf = state.workflows[workflowId];
          if (!wf) return {};
          return patchWorkflow(state, workflowId, {
            documents: wf.documents.filter((d) => d.id !== docId),
          });
        });
      },

      // ── Recordings ───────────────────────────────────────────────────
      addRecording: (workflowId) => {
        const id = generateId();
        set((state) => {
          const wf = state.workflows[workflowId];
          if (!wf) return {};
          const rec: RecordingInput = {
            id,
            state: 'idle',
            duration: 0,
          };
          return patchWorkflow(state, workflowId, {
            recordings: [...wf.recordings, rec],
          });
        });
        return id;
      },

      updateRecording: (workflowId, recordingId, patch) => {
        set((state) => {
          const wf = state.workflows[workflowId];
          if (!wf) return {};
          return patchWorkflow(state, workflowId, {
            recordings: wf.recordings.map((r) =>
              r.id === recordingId ? { ...r, ...patch } : r,
            ),
          });
        });
      },

      removeRecording: (workflowId, recordingId) => {
        set((state) => {
          const wf = state.workflows[workflowId];
          if (!wf) return {};
          return patchWorkflow(state, workflowId, {
            recordings: wf.recordings.filter((r) => r.id !== recordingId),
          });
        });
      },

      // ── Notes ────────────────────────────────────────────────────────
      setNotes: (workflowId, notes) => {
        set((state) => patchWorkflow(state, workflowId, { notes }));
      },

      // ── Medications ──────────────────────────────────────────────────
      addMedication: (workflowId, med) => {
        set((state) => {
          const wf = state.workflows[workflowId];
          if (!wf) return {};
          const newMed: MedicationInput = { ...med, id: generateId() };
          return patchWorkflow(state, workflowId, {
            medications: [...wf.medications, newMed],
          });
        });
      },

      removeMedication: (workflowId, medId) => {
        set((state) => {
          const wf = state.workflows[workflowId];
          if (!wf) return {};
          return patchWorkflow(state, workflowId, {
            medications: wf.medications.filter((m) => m.id !== medId),
          });
        });
      },

      // ── Patient ──────────────────────────────────────────────────────
      setPatientId: (workflowId, patientId) => {
        set((state) => patchWorkflow(state, workflowId, { patientId }));
      },

      setPatientInfo: (workflowId, info) => {
        set((state) => patchWorkflow(state, workflowId, { patientInfo: info }));
      },

      // ── Generation ───────────────────────────────────────────────────
      setJobId: (workflowId, jobId) => {
        set((state) => patchWorkflow(state, workflowId, { jobId }));
      },

      setSyncStatus: (workflowId, status) => {
        set((state) => patchWorkflow(state, workflowId, { syncStatus: status }));
      },
    }),
    {
      name: '@domynote_freestyle',
      storage: createJSONStorage(() => AsyncStorage),
      // Don't persist recording state (active recordings can't survive a restart)
      partialize: (state) => ({
        workflows: Object.fromEntries(
          Object.entries(state.workflows).map(([id, wf]) => [
            id,
            {
              ...wf,
              recordings: wf.recordings.map((r) => ({
                ...r,
                // Reset any active recording state to stopped on persist
                state: ['recording', 'paused'].includes(r.state)
                  ? ('stopped' as RecordingState)
                  : r.state,
              })),
            },
          ]),
        ),
        activeWorkflowId: state.activeWorkflowId,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
