import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ────────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'queued'
  | 'extracting'
  | 'retrieving'
  | 'generating'
  | 'finalizing'
  | 'complete'
  | 'failed';

export interface FreestyleJob {
  id: string;
  workflowId: string;
  patientId?: string;
  patientName?: string;
  status: JobStatus;
  progress: number;          // 0–100
  currentStep?: string;
  resultNote?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

// ── Store Interface ──────────────────────────────────────────────────────────

interface JobsStore {
  jobs: Record<string, FreestyleJob>;

  addJob: (job: FreestyleJob) => void;
  updateJob: (jobId: string, patch: Partial<FreestyleJob>) => void;
  removeJob: (jobId: string) => void;
  getJob: (jobId: string) => FreestyleJob | undefined;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useJobsStore = create<JobsStore>()(
  persist(
    (set, get) => ({
      jobs: {},

      addJob: (job) => {
        set((state) => ({
          jobs: { ...state.jobs, [job.id]: job },
        }));
      },

      updateJob: (jobId, patch) => {
        set((state) => {
          const existing = state.jobs[jobId];
          if (!existing) return {};
          return {
            jobs: {
              ...state.jobs,
              [jobId]: { ...existing, ...patch },
            },
          };
        });
      },

      removeJob: (jobId) => {
        set((state) => {
          const { [jobId]: _, ...rest } = state.jobs;
          return { jobs: rest };
        });
      },

      getJob: (jobId) => get().jobs[jobId],
    }),
    {
      name: '@domynote_jobs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

// ── Derived selectors (call OUTSIDE of useJobsStore selector) ────────────────

/**
 * Get recent jobs sorted by creation date. Use with useMemo or outside component.
 */
export function selectRecentJobs(jobs: Record<string, FreestyleJob>): FreestyleJob[] {
  return Object.values(jobs)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
}

/**
 * Get active (non-terminal) jobs.
 */
export function selectActiveJobs(jobs: Record<string, FreestyleJob>): FreestyleJob[] {
  return Object.values(jobs)
    .filter((j) => !['complete', 'failed'].includes(j.status))
    .sort((a, b) => b.createdAt - a.createdAt);
}
