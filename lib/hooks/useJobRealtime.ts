import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useJobsStore, type JobStatus } from '@/lib/stores/useJobsStore';

/**
 * Subscribe to real-time updates for a specific freestyle job.
 * Updates the local jobs store whenever the server pushes progress.
 */
export function useJobRealtime(jobId: string | null) {
  const updateJob = useJobsStore((s) => s.updateJob);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const channel = supabase
      .channel(`freestyle:${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'freestyle_jobs',
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const row = payload.new as any;
          updateJob(jobId, {
            status: row.status as JobStatus,
            progress: row.progress ?? 0,
            currentStep: row.current_step,
            resultNote: row.result_note,
            error: row.error,
            completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
          });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [jobId, updateJob]);
}

/**
 * Subscribe to real-time updates for ALL active jobs for the current user.
 * Useful for the Jobs Dashboard to show live progress on all in-flight jobs.
 */
export function useAllJobsRealtime() {
  const updateJob = useJobsStore((s) => s.updateJob);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('freestyle_all_jobs')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'freestyle_jobs',
        },
        (payload) => {
          const row = payload.new as any;
          updateJob(row.id, {
            status: row.status as JobStatus,
            progress: row.progress ?? 0,
            currentStep: row.current_step,
            resultNote: row.result_note,
            error: row.error,
            completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
          });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [updateJob]);
}
