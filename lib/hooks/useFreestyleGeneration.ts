import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useFreestyleStore } from '@/lib/stores/useFreestyleStore';
import { useJobsStore, type FreestyleJob } from '@/lib/stores/useJobsStore';
import { generateFreestyle } from '@/lib/api/freestyle';
import { ensureAIConsent } from '@/lib/ai-consent';

const IMAGE_MAX_WIDTH = 1000;
const IMAGE_COMPRESS = 0.6;

interface UseFreestyleGenerationReturn {
  generate: (workflowId: string) => Promise<string | null>;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
}

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function readDocBase64(
  uri: string,
  type: 'pdf' | 'image',
): Promise<string> {
  if (Platform.OS === 'web') {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  if (type === 'image') {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: IMAGE_MAX_WIDTH } }],
        { compress: IMAGE_COMPRESS, format: ImageManipulator.SaveFormat.JPEG },
      );
      return FileSystem.readAsStringAsync(manipulated.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      return FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  }
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

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

    const allowed = await ensureAIConsent();
    if (!allowed) {
      setError('AI consent is required to generate notes.');
      return null;
    }

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);
    setSyncStatus(workflowId, 'syncing');

    try {
      const readyRecordings = workflow.recordings.filter(
        (r) => r.uri && r.state !== 'idle',
      );
      const totalItems = workflow.documents.length + readyRecordings.length;
      let completedItems = 0;

      const bumpProgress = () => {
        completedItems++;
        if (totalItems > 0) {
          setUploadProgress((completedItems / totalItems) * 90);
        }
      };

      const [docResults, recResults] = await Promise.all([
        Promise.all(
          workflow.documents.map(async (doc) => {
            try {
              const fileBase64 = await readDocBase64(doc.uri, doc.type);
              const storagePath = `freestyle/${user.id}/${workflowId}/docs/${doc.id}.${doc.type === 'image' ? 'jpg' : 'pdf'}`;
              const { error: uploadError } = await supabase.storage
                .from('freestyle-documents')
                .upload(storagePath, decode(fileBase64), {
                  contentType: doc.type === 'image' ? 'image/jpeg' : 'application/pdf',
                  upsert: true,
                });

              if (uploadError) {
                console.warn(`Doc upload failed: ${uploadError.message}`);
                return null;
              }
              return {
                storage_path: storagePath,
                type: doc.type,
                name: doc.name,
                label: doc.label,
              };
            } catch (e: any) {
              console.warn(`Failed to upload doc ${doc.name}:`, e?.message);
              return null;
            } finally {
              bumpProgress();
            }
          }),
        ),
        Promise.all(
          readyRecordings.map(async (rec) => {
            try {
              let audioBase64: string;
              if (Platform.OS === 'web') {
                const resp = await fetch(rec.uri!);
                const blob = await resp.blob();
                audioBase64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
              } else {
                audioBase64 = await FileSystem.readAsStringAsync(rec.uri!, {
                  encoding: FileSystem.EncodingType.Base64,
                });
              }

              const ext = rec.uri!.includes('.webm') ? 'webm' : 'm4a';
              const storagePath = `freestyle/${user.id}/${workflowId}/audio/${rec.id}.${ext}`;
              const { error: uploadError } = await supabase.storage
                .from('freestyle-recordings')
                .upload(storagePath, decode(audioBase64), {
                  contentType: ext === 'webm' ? 'audio/webm' : 'audio/m4a',
                  upsert: true,
                });

              if (uploadError) {
                console.warn(`Audio upload failed: ${uploadError.message}`);
                return null;
              }
              return {
                storage_path: storagePath,
                transcript: rec.transcript,
                duration_s: rec.duration,
              };
            } catch (e: any) {
              console.warn(`Failed to upload recording ${rec.id}:`, e?.message);
              return null;
            } finally {
              bumpProgress();
            }
          }),
        ),
      ]);

      const uploadedDocs = docResults.filter(Boolean) as Array<{
        storage_path: string;
        type: 'pdf' | 'image';
        name: string;
        label?: string;
      }>;
      const uploadedRecordings = recResults.filter(Boolean) as Array<{
        storage_path: string;
        transcript?: string;
        duration_s: number;
      }>;

      setUploadProgress(95);

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
        custom_instructions: workflow.customInstructions || '',
        em_level: workflow.emLevel ?? null,
      });

      setUploadProgress(100);
      setJobId(workflowId, result.job_id);
      setSyncStatus(workflowId, 'synced');

      addJob({
        id: result.job_id,
        workflowId,
        patientId: workflow.patientId || undefined,
        patientName: workflow.patientInfo?.name,
        status: 'queued',
        progress: 0,
        createdAt: Date.now(),
      });

      return result.job_id;
    } catch (e: any) {
      console.error('Generation failed:', e?.message);
      setError(e?.message || 'Generation failed');
      setSyncStatus(workflowId, 'failed');
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [user, setJobId, setSyncStatus, addJob]);

  return { generate, isUploading, uploadProgress, error };
}
