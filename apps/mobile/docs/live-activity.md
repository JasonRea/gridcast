# Plan: Live Activity / Dynamic Island scorebug (P2, not built)

Native work, so this is a plan only. Nothing here runs in Expo Go.

## What it shows

- Compact (Dynamic Island, leading/trailing): away abbr + score, home abbr + score, team color dots.
- Expanded / Lock Screen: both teams, scores, `Q4 2:47`, down and distance with ball spot,
  possession dot, win probability bar, last play headline (from `headline()` in
  `apps/web/src/lib/plays.ts`). Odds line only with the "information only" footer text.

## How

1. Development build only: add a widget extension with a config plugin. Candidates:
   `expo-live-activity` style community module, or a local Expo module
   (`npx create-expo-module --local live-activity`) wrapping ActivityKit
   (`Activity.request`, `activity.update`, `activity.end`). Ask before adding the dependency.
2. SwiftUI views in the extension target (`ActivityConfiguration` + `DynamicIsland`), styled with
   the PRD tokens (black, white, team colors, tabular numerals).
3. JS side: start the activity when a live game screen opens (user opt-in button), update it from
   the same store the scorebug uses (`useGame` state after each `finishPlay`), throttled to ~1
   update per play, end it on final or when the user leaves.
4. Background updates while the app is closed need ActivityKit push updates
   (APNs `liveactivity` push type). That needs a server endpoint and an APNs key, which is a
   server change (out of scope for this app), so phase 1 updates only while the app runs.
5. `Info.plist`: `NSSupportsLiveActivities = true` via `app.json` `ios.infoPlist`.

## Risks

- ActivityKit update budget: frequent updates are throttled by iOS; one per play is fine.
- Requires iOS 16.2+; hide the button below that.
