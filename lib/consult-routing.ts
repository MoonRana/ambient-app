import { router } from 'expo-router';
import { useFreestyleStore } from '@/lib/stores/useFreestyleStore';

/** User wants an H&P / SOAP — Consult is Q&A only; Freestyle builds notes. */
const NOTE_BUILD_PATTERNS = [
  /\bbuild\s+(a\s+)?note\b/i,
  /\bgenerate\s+(a\s+)?(note|h&p|hp|soap|chart)\b/i,
  /\bwrite\s+(a\s+)?(note|h&p|hp|soap|chart)\b/i,
  /\bcreate\s+(a\s+)?(note|h&p|hp|soap|chart|documentation)\b/i,
  /\bnote\s+(off|from|using)\s+(those|these|the|my)\b/i,
  /\b(h&p|hp|soap)\s+from\b/i,
  /\bdocument(ation)?\s+from\s+(those|these|the|my)\s+labs\b/i,
  /\bclinical\s+note\s+from\b/i,
];

export function isNoteGenerationRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return NOTE_BUILD_PATTERNS.some((re) => re.test(t));
}

/** Create or extend active Freestyle workspace and open the note builder. */
export function routeToFreestyleWithDocument(documentText?: string | null): void {
  const store = useFreestyleStore.getState();
  let workflowId = store.activeWorkflowId;
  if (!workflowId || !store.workflows[workflowId]) {
    workflowId = store.createWorkflow();
  }

  const trimmed = documentText?.trim();
  if (trimmed) {
    const wf = store.workflows[workflowId];
    const header = 'Scanned document (from Consult):';
    const block = `${header}\n${trimmed}`;
    const notes = wf.notes?.trim() ? `${wf.notes.trim()}\n\n---\n\n${block}` : block;
    store.setNotes(workflowId, notes);
  }

  router.push('/(tabs)/freestyle');
}
