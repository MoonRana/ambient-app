# App Store screenshots (DoMyNote Ambient)

App Store Connect asks for **up to 10 screenshots** and **up to 3 app preview videos** for the **6.5" / 6.7" iPhone** display slot. Drag files into:

**App Store Connect → Your app → App Store → iOS App → Screenshots**

> **TestFlight:** Internal TestFlight builds do **not** require screenshots. You need these when completing the **App Store listing** or submitting for **App Review** (including many external-beta flows).

## Required pixel sizes (portrait)

| Display | Portrait | Landscape (optional) |
|---------|----------|----------------------|
| 6.7" (recommended) | **1284 × 2778** | 2778 × 1284 |
| 6.5" (alternate) | **1242 × 2688** | 2688 × 1242 |

You only need **one** iPhone size set; Apple scales for smaller devices. Use the **6.7"** set (`1284×2778`) if you capture once.

## Manual Simulator screenshots → resize

If you saved screenshots from Simulator (⌘S) into `ios-6.7/`:

```bash
npm run screenshots:organize
```

This copies them to `raw/`, resizes to **1242×2688** (`ios-6.5/`) and **1284×2778** (`ios-6.7/`), and skips duplicate Freestyle captures.

**Do not upload** raw `1320×2868` Simulator files — App Store Connect will reject them.

## One-command capture (recommended)

With **iPhone 16 Pro Max** booted in Simulator:

```bash
npm run screenshots:run
```

This starts Expo in **screenshot demo mode** (mock patients/sessions, no login), captures 10 screens, and writes **1284×2778** PNGs to `store-screenshots/ios-6.7/`.

## Manual workflow (Simulator)

1. **Boot the large iPhone simulator** (any Pro Max is fine):

   ```bash
   open -a Simulator
   # Hardware → Device → iPhone 16 Pro Max (or 15 Pro Max)
   ```

2. **Run the app** on that simulator:

   ```bash
   npx expo run:ios --device "iPhone 16 Pro Max"
   # or: npx expo start  → press i
   ```

3. Sign in with a **demo account** that has sample sessions/jobs so screens look populated.

4. **Capture each screen** (⌘S in Simulator, or):

   ```bash
   npm run screenshots:capture -- 01-inbox
   ```

   Save raw PNGs under `store-screenshots/raw/` (any filename).

5. **Resize to App Store dimensions**:

   ```bash
   npm run screenshots:resize
   ```

6. Upload everything in `store-screenshots/ios-6.7/` to App Store Connect (up to 10 PNGs).

## Suggested 10 screenshots (in order)

| # | Screen | How to get there |
|---|--------|------------------|
| 1 | Inbox / home | `(tabs)` → Inbox |
| 2 | Start encounter | Tap **New Encounter** |
| 3 | Recording | Patient info → Record (waveform) |
| 4 | Review note | After capture → Review |
| 5 | Session detail | Open a completed session |
| 6 | History | History tab |
| 7 | Consult | Consult tab |
| 8 | Freestyle | Freestyle tab |
| 9 | Jobs queue | Jobs tab |
| 10 | Settings | Settings tab |

Use **light mode** for consistency unless your brand is dark-first.

## App previews (optional, max 3)

- **Format:** `.mov` or `.mp4`, H.264, 15–30 seconds each  
- **Same display size** as screenshots (portrait 1284×2778 or landscape 2778×1284)  
- Record with **QuickTime → File → New Screen Recording** while the simulator is focused, or `xcrun simctl io booted recordVideo preview-01.mov`

## Folder layout

```
store-screenshots/
  README.md           ← this file
  raw/                ← simulator captures (gitignored)
  ios-6.7/            ← upload these (1284×2778)
  ios-6.5/            ← optional second size (1242×2688)
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Upload rejected for wrong size | Run `npm run screenshots:resize` — do not upload `raw/` files |
| Simulator shot is 1320×2868 | Normal for iPhone 16 Pro Max; resize script fixes it |
| Blank inbox | Sign in; create or seed demo sessions first |
| Only need TestFlight now | Skip screenshots until you submit for App Review |
