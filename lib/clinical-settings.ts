/** Where the clinician primarily practices — drives home hero and Freestyle defaults. */
export type ClinicalSetting = 'clinic' | 'nursing_home' | 'assisted_living';

export type DefaultHomeAction = 'freestyle_capture' | 'freestyle' | 'record';

export const CLINICAL_SETTING_LABELS: Record<ClinicalSetting, string> = {
  clinic: 'Clinic',
  nursing_home: 'Nursing Home',
  assisted_living: 'Assisted Living',
};

export function getDefaultsForClinicalSetting(setting: ClinicalSetting): {
  defaultHomeAction: DefaultHomeAction;
  freestyleShowRecording: boolean;
} {
  if (setting === 'assisted_living') {
    return { defaultHomeAction: 'record', freestyleShowRecording: true };
  }
  return { defaultHomeAction: 'freestyle_capture', freestyleShowRecording: false };
}

export function permissionContextCopy(setting: ClinicalSetting): string {
  if (setting === 'assisted_living') {
    return 'Recording captures the visit when you\'re working alone.';
  }
  return 'Recording is optional. Many clinicians prefer uploading labs and notes in Freestyle.';
}
