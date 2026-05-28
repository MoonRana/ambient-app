# App Store Connect — submission checklist (DoMyNote Ambient)

Use this to clear **Unable to Add for Review** for app **6769185126**.

## 1. Screenshot — 6.5-inch iPhone (required)

App Store Connect has **separate slots per display size**. Uploading 6.7" only is not enough.

1. Open [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → **DoMyNote Ambient** → **App Store** → **iOS App** → **Screenshots**
2. Select **iPhone 6.5" Display** (not 6.7")
3. Drag **up to 10** PNGs from:

   ```
   store-screenshots/ios-6.5/
   ```

   Files are **1242 × 2688** (verified). Use the same order as `01-inbox.png` … `10-patient-info.png`.

## 2. Privacy Policy URL (required)

**App Privacy** → **Privacy Policy URL**

- Enter: `https://domynote.com/privacy`
- That URL must return **200** in a browser (currently **404** until you publish).

**Publish the policy:** upload `legal/privacy-policy.html` from this repo to your site so it is live at:

- `https://domynote.com/privacy`

Also publish `legal/terms-of-service.html` at `https://domynote.com/terms` (linked from the app Settings screen).

## 3. App Privacy questionnaire

**App Privacy** → complete all data-collection questions for:

- Email (account)
- Audio / photos (if declared)
- Health-related user content

Match what the app actually collects. Link the same privacy policy URL above.

## 4. Content Rights Information

**App Information** → **Content Rights**

- If the app only shows **your** UI and **user-entered** clinical content (no licensed music, news feeds, or third-party catalogs): choose **No** — it does not contain, show, or access third-party content.
- If unsure, answer honestly; most clinical tools qualify as **No**.

## 5. Pricing

**Pricing and Availability** → **Price Schedule**

- Set **Price** → **Free** (tier 0), or choose a paid tier.
- Save.

## 6. Primary category

**App Information** → **Category**

- **Primary:** `Medical`
- **Secondary (optional):** `Productivity` or `Health & Fitness`

Save.

## 7. Keywords — English (U.S.) (required)

**App Store** → **English (U.S.)** → **Keywords** (max 100 characters, comma-separated, **no spaces** after commas):

```
clinical,SOAP,medical,scribe,ambient,doctor,healthcare,notes,AI,physician,HIPAA,encounter
```

(99 characters — adjust if Apple reports length errors.)

Also confirm these are filled on the same localization:

- **Subtitle** (optional but recommended)
- **Description**
- **Support URL** (e.g. `https://domynote.com` or `mailto:ranamansoorv7@gmail.com` — Apple prefers a URL; use `https://domynote.com` if support page exists)
- **Marketing URL** (optional)

## 8. Fix “one or more errors on this page”

Usually caused by empty required fields on the **English (U.S.)** version page. Scroll the full form and fix red highlights:

- Keywords (above)
- Copyright (e.g. `2026 DoMyNote`)
- Age Rating questionnaire (complete under **App Information**)
- Build selected under **Build** section for this version
- Export compliance (already `ITSAppUsesNonExemptEncryption: false` in `app.json`)

## Quick verification

| Item | Status |
|------|--------|
| 6.5" PNGs in repo | `store-screenshots/ios-6.5/` ✓ |
| Privacy URL live | Publish `legal/privacy-policy.html` → domynote.com |
| Keywords | Paste line in §7 |
| Category | Medical |
| Price | Free (or your tier) |
| Content rights | No third-party content (typical) |

After all items are green, **Add for Review** should enable.
