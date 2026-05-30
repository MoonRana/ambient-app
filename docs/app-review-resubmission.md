# App Review resubmission — DoMyNote Ambient (build 9+)

Submission ID: `ab156b51-8a5d-4807-8f1b-4569f8553f60`

## Code fixes in this build

| Guideline | Fix |
|-----------|-----|
| **4 — iPad microphone page** | Permission screen uses scroll + non-overlapping footer; compact layout on iPad |
| **2.1 — Consult error** | Fetch-based SSE streaming (iPad fallback) + clearer auth/network errors |
| **5.1.1 / 5.1.2 — AI consent** | Full-screen in-app consent modal before any AI data is sent; lists data, providers, and purpose |
| **5.1.2 — Tracking** | App does **not** track users — update App Store Connect labels (see below) |
| **Privacy policy** | Updated `legal/privacy-policy.html` with third-party AI disclosure |

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
