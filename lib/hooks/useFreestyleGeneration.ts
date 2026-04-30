import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useFreestyleStore, type FreestyleWorkflow } from '@/lib/stores/useFreestyleStore';
import { useJobsStore, type FreestyleJob } from '@/lib/stores/useJobsStore';
import { generateFreestyle } from '@/lib/api/freestyle';

interface UseFreestyleGenerationReturn {
  generate: (workflowId: string) => Promise<string | null>;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
}

/**
 * Hook to handle the full generation flow:
 * 1. Upload documents/recordings to Supabase Storage
 * 2. Call freestyle-generate edge function
 * 3. Create a job entry in the local jobs store
 */
export function useFreestyleGeneration(): UseFreestyleGenerationReturn {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const setJobId = useFreestyleStore((s) => s.setJobId);
  const setSyncStatus = useFreestyleStore((s) => s.setSyncStatus);
  const addJob = useJobsStore((s) => s.addJob);

  const generate = useCallback(async (workflowId: string): Promise<string | null> => {
    const workflow = useFreestyleStore.getState().workflows[workflowId];
    if (!workflow || !user) {
      setError('No workflow or user found');
      return null;
    }

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);
    setSyncStatus(workflowId, 'syncing');

    try {
      // 1. Upload documents to Supabase Storage
      const uploadedDocs = [];
      for (let i = 0; i < workflow.documents.length; i++) {
        const doc = workflow.documents[i];
        setUploadProgress((i / (workflow.documents.length + workflow.recordings.length)) * 100);

        try {
          let fileBase64: string;
          if (Platform.OS === 'web') {
            const resp = await fetch(doc.uri);
            const blob = await resp.blob();
            fileBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } else {
            // Compress images before upload
            if (doc.type === 'image') {
              try {
                const manipulated = await ImageManipulator.manipulateAsync(
                  doc.uri,
                  [{ resize: { width: 2048 } }],
                  { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
                );
                fileBase64 = await FileSystem.readAsStringAsync(manipulated.uri, {
                  encoding: FileSystem.EncodingType.Base64,
                });
              } catch {
                fileBase64 = await FileSystem.readAsStringAsync(doc.uri, {
                  encoding: FileSystem.EncodingType.Base64,
                });
              }
            } else {
              fileBase64 = await FileSystem.readAsStringAsync(doc.uri, {
                encoding: FileSystem.EncodingType.Base64,
              });
            }
          }

          const storagePath = `freestyle/${user.id}/${workflowId}/docs/${doc.id}.${doc.type === 'image' ? 'jpg' : 'pdf'}`;
          const { error: uploadError } = await supabase.storage
            .from('freestyle-documents')
            .upload(storagePath, decode(fileBase64), {
              contentType: doc.type === 'image' ? 'image/jpeg' : 'application/pdf',
              upsert: true,
            });

          if (uploadError) {
            console.warn(`Doc upload failed: ${uploadError.message}`);
            continue;
          }

          uploadedDocs.push({
            storage_path: storagePath,
            type: doc.type,
            name: doc.name,
          });
        } catch (e: any) {
          console.warn(`Failed to upload doc ${doc.name}:`, e?.message);
        }
      }

      // 2. Upload recordings to Supabase Storage
      const uploadedRecordings = [];
      for (let i = 0; i < workflow.recordings.length; i++) {
        const rec = workflow.recordings[i];
        if (!rec.uri || rec.state === 'idle') continue;

        setUploadProgress(
          ((workflow.documents.length + i) /
            (workflow.documents.length + workflow.recordings.length)) *
            100,
        );

        try {
          let audioBase64: string;
          if (Platform.OS === 'web') {
            const resp = await fetch(rec.uri);
            const blob = await resp.blob();
            audioBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } else {
            audioBase64 = await FileSystem.readAsStringAsync(rec.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }

          const ext = rec.uri.includes('.webm') ? 'webm' : 'm4a';
          const storagePath = `freestyle/${user.id}/${workflowId}/audio/${rec.id}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from('freestyle-recordings')
            .upload(storagePath, decode(audioBase64), {
              contentType: ext === 'webm' ? 'audio/webm' : 'audio/m4a',
              upsert: true,
            });

          if (uploadError) {
            console.warn(`Audio upload failed: ${uploadError.message}`);
            continue;
          }

          uploadedRecordings.push({
            storage_path: storagePath,
            transcript: rec.transcript,
            duration_s: rec.duration,
          });
        } catch (e: any) {
          console.warn(`Failed to upload recording ${rec.id}:`, e?.message);
        }
      }

      setUploadProgress(100);

      // 3. Call freestyle-generate
      const result = await generateFreestyle({
        patient_id: workflow.patientId,
        documents: uploadedDocs,
        recordings: uploadedRecordings,
        notes: workflow.notes,
        medications: workflow.medications.map((m) => ({
          medication_name: m.name,
          dosage: m.dose,
          frequency: m.frequency,
        })),
      });

      // 4. Store job reference
      setJobId(workflowId, result.job_id);
      setSyncStatus(workflowId, 'synced');

      const job: FreestyleJob = {
        id: result.job_id,
        workflowId,
        patientId: workflow.patientId || undefined,
        patientName: workflow.patientInfo?.name,
        status: 'queued',
        progress: 0,
        createdAt: Date.now(),
      };
      addJob(job);

      return result.job_id;
    } catch (e: any) {
      console.error('Generation failed:', e?.message);
      setError(e?.message || 'Generation failed');
      setSyncStatus(workflowId, 'failed');
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [user]);

  return { generate, isUploading, uploadProgress, error };
}

// Base64 decode helper
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
