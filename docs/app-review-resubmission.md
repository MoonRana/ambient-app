# App Review resubmission — DoMyNote Ambient (build 9+)

Submission ID: `3e0f6f3e-55fd-47ff-b552-ee470a5896c1`

---

## ⚠️ Latest rejection — 5.1.1(i) / 5.1.2(i) (Jun 2, 2026, iPad Air M3)

> "The app appears to share the user's personal data with a third-party AI service but the app does not clearly identify who the data is sent to before sharing the data."

### Root causes found

1. **Code gap — scanning bypassed consent.** Insurance-card / document scanning sent photos to the AI **before** showing the consent modal:
   - `app/(recording)/record.tsx` → `quickScanImage()` (insurance card quick scan)
   - `app/(recording)/capture.tsx` → `handleScanImage()` (insurance / clinical / medication scan)
   - **Fix:** both now call `ensureAIConsent()` first (matches Consult, Freestyle, and SOAP review).
2. **Privacy policy URL is dead (404).** `https://domynote.com/privacy` returns **404** (root domain is 200). Apple cannot verify the third-party AI disclosure. **This must be published — see manual steps below.**

### Every AI data-sharing path now gated by `ensureAIConsent()`

| Flow | File | Status |
|------|------|--------|
| Consult question | `lib/consult-context.tsx` `sendQuestion` | ✅ |
| Consult document attach | `lib/consult-context.tsx` `attachDocument` | ✅ |
| SOAP note generation (audio + docs) | `app/(recording)/review.tsx` `handleGenerateNote` | ✅ |
| Freestyle generation | `lib/hooks/useFreestyleGeneration.ts` | ✅ |
| Insurance quick scan (record) | `app/(recording)/record.tsx` `quickScanImage` | ✅ (fixed) |
| Document scan (capture) | `app/(recording)/capture.tsx` `handleScanImage` | ✅ (fixed) |

The consent modal (`components/AIConsentModal.tsx`) explicitly names recipients **before** any data is sent: Supabase, AWS HealthScribe, OpenAI.

### 🔴 REQUIRED manual step — publish the privacy policy

The single biggest blocker. Deploy `legal/privacy-policy.html` so these return **200**:

- `https://domynote.com/privacy`  ← currently **404**
- `https://domynote.com/terms`    ← currently **404** (deploy `legal/terms-of-service.html`)

The policy already identifies (Section 4) the third-party AI processors, what data is sent, and how it's used. It just isn't live yet.

### Reply to 5.1.1(i) / 5.1.2(i) rejection

```
Thank you for the detailed feedback. We have addressed both points:

WHO + CONSENT BEFORE SHARING: Every feature that sends data to a third-party AI
service now shows an in-app "AI Data Processing Consent" screen BEFORE any data
leaves the device. The screen explicitly names each recipient — Supabase (secure
hosting/auth), AWS HealthScribe (medical transcription), and OpenAI (note
generation and consult) — and lists exactly what data is sent. The user must tap
"I Agree — Enable AI Features" to proceed. We also closed two paths (insurance-card
and clinical-document scanning) that previously processed images before showing
this screen; they now require consent first.

PRIVACY POLICY: Our privacy policy now identifies what data we collect, how we
collect it, all uses, and the third-party AI services we share with (Supabase,
AWS HealthScribe, OpenAI), including the safeguards they operate under. It is
published at https://domynote.com/privacy and linked from the consent screen and
the app's Settings.

This is included in the app build, not only in the Terms of Service.
```

---

## Code fixes in this build

| Guideline | Fix |
|-----------|-----|
| **4 — iPad microphone page** | Permission screen uses scroll + non-overlapping footer; compact layout on iPad |
| **2.1 — Consult error** | Fetch-based SSE streaming (iPad fallback) + clearer auth/network errors |
| **5.1.1 / 5.1.2 — AI consent** | Full-screen in-app consent modal before any AI data is sent; lists data, providers, and purpose |
| **5.1.2 — Tracking** | App does **not** track users — update App Store Connect labels (see below) |
| **Privacy policy** | Updated `legal/privacy-policy.html` with third-party AI disclosure |
| **2.3.3 — Screenshots** | Fresh 6.5" captures from current build via `npm run screenshots:run` |

---

## Guideline 2.3.3 — Screenshot resubmission (build 9)

Apple rejected the **6.5-inch iPhone** screenshots because they did not reflect the current app UI (Settings was included; core flows were missing).

### Capture fresh screenshots

```bash
# Boot iPhone 16 Pro Max (or 15 Pro Max) in Simulator, then:
npm run screenshots:run
```

Upload PNGs from `store-screenshots/ios-6.5/` (1242×2688) in this order:

| # | Screen | Why |
|---|--------|-----|
| 1 | Home | Recent encounters + start recording |
| 2 | Record | Core ambient scribe flow |
| 3 | Session detail | Completed SOAP note |
| 4 | Review | Note generation / SOAP preview |
| 5 | Freestyle | Document workflows |
| 6 | Consult | Clinical Q&A |
| 7 | History | Past sessions |
| 8 | Patient info | Encounter context capture |

**Do not upload** login, splash, or Settings as primary screenshots.

Use **light mode** consistently. In App Store Connect → Previews and Screenshots → **View All Sizes in Media Manager** if any size slot is hidden.

### Reply to 2.3.3 rejection

```
Thank you for the feedback. We have replaced all 6.5-inch iPhone screenshots with
new captures from build 9 that show the app's core functionality: ambient recording,
SOAP note review, session history, Freestyle document workflows, and STAT Consult.
Settings and login screens have been removed from the screenshot set.
```

---

## App Store Connect — required manual steps

### 1. Fix “Tracking” privacy label (Guideline 5.1.2)

**App Store Connect → App Privacy → Data Types**

For **Email, Name, Phone Number, Physical Address** (and any other contact fields):

- Set **Used for Tracking** → **No**
- Set purposes to **App Functionality**, **Account Management** only — **not** Third-Party Advertising or Developer Advertising

DoMyNote does **not** use App Tracking Transparency because it does **not** track users across apps/websites for advertising or share data with data brokers.

### 2. Privacy Policy URL

Set to: `https://domynote.com/privacy`  
(Publish `legal/privacy-policy.html` to that URL if not live.)

### 3. Review Notes (paste into App Store Connect)

```
AI CONSENT (Guideline 5.1.1):
Before any clinical data is sent to third-party AI, the app shows a full-screen
"AI Data Processing Consent" modal listing: (1) what data is sent, (2) who
receives it (Supabase, AWS HealthScribe, OpenAI), and (3) requires tapping
"I Agree — Enable AI Features". Shown before Consult, note generation,
Freestyle generation, and document scanning in Consult.

To test: Sign in → Consult tab → tap a sample question → consent modal appears
→ tap "I Agree" → ask a clinical question.

TRACKING (Guideline 5.1.2):
This app does NOT track users. App Privacy labels have been corrected to set
"Used for Tracking" = No for all data types. No ATT prompt is shown because
no cross-app tracking occurs.

IPAD MICROPHONE PAGE (Guideline 4):
Home → Start New Encounter → microphone permission screen. Content scrolls and
all text/buttons are visible on iPad.

CONSULT (Guideline 2.1):
Consult tab → tap example question → agree to AI consent → response streams.
Demo account: [provide credentials for reviewer]
```

### 4. Reply to rejection in App Store Connect

```
Thank you for the detailed feedback. We have addressed all issues in build 9:

1. Tracking: We do not track users. App Privacy Information has been updated so
   no data types are marked "Used for Tracking." We do not use ATT.

2. iPad microphone page: Layout revised — scrollable content, visible text,
   footer no longer overlaps content on iPad Air.

3. Consult error: Fixed streaming on iPad with improved network handling and
   clearer session error messages.

4. AI consent: Added mandatory in-app consent modal before any data is sent to
   third-party AI (Supabase, AWS HealthScribe, OpenAI). Privacy policy updated.

Please let us know if you need a demo account.
```

---

## TestFlight public link (client demo)

1. Submit build to App Store Connect:
   ```bash
   eas build --platform ios --profile production
   eas submit --platform ios --latest
   ```

2. **App Store Connect → TestFlight → External Testing**
   - Create group → add build 9
   - Enable **Public Link**
   - Share: `https://testflight.apple.com/join/XXXXXXXX`

3. Expo project dashboard:  
   https://expo.dev/accounts/moonrana/projects/domynote-ambient

---

## Reviewer test path

1. Sign in
2. **Consult** → tap sample question → **AI consent modal** → Agree → verify answer
3. **Home** → New Encounter → **microphone permission** (verify text visible on iPad)
4. Complete recording flow → **Review** → Generate SOAP → consent if first time
