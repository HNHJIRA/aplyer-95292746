# WriteDNA — Browser Smoke Test Checklist

Owner-run manual QA. Automated coverage lives in `src/**/__tests__/`
(`bun run test`, 30 tests). This checklist covers only what cannot be
automated in the sandbox.

## 1. Build & load the extension

```bash
bun run build:extension
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → select the built `extension/` directory.
4. After code changes, click the reload icon on the extension card.

## 2. Inspect extension storage

Open the extension's DevTools (right-click popup → *Inspect*), then in the
Console:

```js
chrome.storage.local.get(null).then(console.log)
```

Expected keys: `aplyer.v1` (single namespace).

## 3. User A → logout → User B procedure

| # | Step | Expected |
|---|------|----------|
| 1 | Sign in as User A | Popup lands on canonical route (see §5) |
| 2 | Dump `chrome.storage.local` | `activeUserId` = User A id |
| 3 | Logout from popup or dashboard | Popup returns to Welcome / Sign In |
| 4 | Dump `chrome.storage.local` again | `aplyer.v1` cleared or defaulted; no User A resume, samples, Voice Card, A/B, profile |
| 5 | Sign in as User B | Popup shows only User B canonical state |
| 6 | Dump storage | `activeUserId` = User B id; zero User A leakage |
| 7 | Sign back in as User A | User A data rehydrates from backend |

## 4. Expected WriteDNA scores

| Backend state | stage | voice_confidence | voice_card_status |
|---|---|---|---|
| no resume, no samples | idle | 0 | locked |
| resume, 0 samples | building | 0 | locked |
| resume + 1 qualifying sample | good | 50 | collecting_samples |
| resume + 2 qualifying samples | strong | 90 | eligible |
| generated Voice Card | strong | 100 | generated |
| generated + source mutated | strong | 90 | stale |
| deleted 1 of 2 samples | good | 50 | collecting_samples |
| deleted all samples | building | 0 | locked |

## 5. Expected canonical routing

| Backend state | Popup screen |
|---|---|
| no resume | Resume Upload |
| resume + 0 samples | WriteDNA Progress (Building) |
| resume + 1 sample | WriteDNA Progress (Good) |
| resume + 2 samples, eligible | Voice Card (Generate CTA) |
| voice_card_status = generating | Voice Card (spinner) |
| voice_card_status = failed | Voice Card (Retry) |
| voice_card_status = stale | Voice Card (Regenerate) |
| generated + A/B incomplete | A/B Demo |
| generated + A/B complete + profile empty | Profile |
| generated + A/B complete + profile filled | Done / extension home |
| resume_only = true, 0 samples | Profile → Success |

## 6. Network-throttling stale-flash test

1. DevTools → Network → throttle to **Slow 3G**.
2. Open popup while signed in.
3. Only the neutral loading state may render until hydration completes.
   No cached screen from a prior account may flash.

## 7. Voice Card popup-close recovery

1. Trigger Voice Card generation (2 qualifying samples + click Generate).
2. Close the popup while status = `generating`.
3. Reopen within 60s → status = `generating` (polling continues).
4. Reopen after generation → status = `generated`, structured card renders.
5. Force a failure (e.g. drop network) → status = `failed`, Retry visible.

## 8. Logout from each major screen

Repeat logout from: Welcome (signed in), Resume Upload, WriteDNA Progress,
Voice Card, A/B Demo, Profile, Success/Done, Dashboard (web).

Each must:
- clear `chrome.storage.local`
- clear the local `aplyer.v1` namespace
- return the popup to Welcome / Sign In
- not leave any user-scoped state behind

## 9. Extension / Dashboard parity

Open `/dashboard` in the web app in parallel with the popup. WriteDNA card,
voice confidence, stage label, and Voice Card structured content must match
byte-for-byte with the popup for the same user.

## 10. Recording table

| Case | Result (PASS/FAIL) | Notes |
|---|---|---|
| §3 account switch | | |
| §4 score matrix | | |
| §5 canonical routing (all rows) | | |
| §6 stale-flash | | |
| §7 Voice Card recovery | | |
| §8 logout from each screen | | |
| §9 popup / dashboard parity | | |

Only mark this phase production-approved after every row is PASS.
