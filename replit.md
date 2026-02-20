# DoMyNote Ambient

## Overview
HIPAA-compliant clinical documentation app that allows healthcare providers to record patient encounters, capture clinical documents via camera, and generate structured SOAP notes using ambient AI recording with AWS HealthScribe.

## Architecture
- **Frontend**: React Native + Expo (file-based routing with expo-router)
- **Backend**: Express server on port 5000 (landing page + API proxy)
- **External Backend**: Supabase with edge functions for audio processing via AWS HealthScribe
- **State Management**: React Context (sessions), AsyncStorage for persistence, React Query for server state

## Key Files
- `lib/supabase.ts` - Supabase client configuration
- `lib/supabase-api.ts` - Edge function API service (upload, transcribe, generate SOAP)
- `lib/session-context.tsx` - Session state management with AsyncStorage persistence
- `lib/settings-context.tsx` - App settings context
- `app/(tabs)/` - Main tab screens (Record, History, Settings)
- `app/(recording)/` - Multi-step recording wizard (permission → record → capture → review)
- `app/session-detail.tsx` - Session detail view with SOAP note display
- `constants/colors.ts` - Theme colors (navy #0B6E99, teal #00B4A0)

## Supabase Integration
- URL stored in `EXPO_PUBLIC_SUPABASE_URL` env var
- Anon key stored in `EXPO_PUBLIC_SUPABASE_ANON_KEY` secret
- Edge functions: upload-audio-to-s3, start-healthscribe-job, get-healthscribe-status, fetch-healthscribe-results, generate-soap-note

## Recording Flow
1. Permission screen → request microphone access
2. Audio recording with waveform visualization (expo-av)
3. Document capture via camera (expo-image-picker)
4. Review screen → uploads audio to S3, starts HealthScribe job, polls for completion, generates SOAP note

## Session Data Model
- `AmbientSession`: id, status, recordingDuration, recordingUri, capturedImages, patientContext, audioS3Uri, healthscribeJobName, transcript, soapNote, fullNote, errorMessage

## Recent Changes
- 2026-02-20: Connected Supabase backend with edge function API service
- 2026-02-20: Updated review screen to use real audio upload + HealthScribe pipeline
- 2026-02-20: Added processing progress UI with step-by-step feedback
- 2026-02-20: Added transcript display to session detail view
- 2026-02-20: Extended session model with backend fields (audioS3Uri, transcript, etc.)
