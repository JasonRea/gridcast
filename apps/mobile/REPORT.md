# Gridcast iOS: build report

Build of `MOBILE_PROMPT.md`, done in one run on branch `feat/mobile-ios`. You asked to keep
going without stopping, so the prompt's stop points (plan, M1, M3, new dependencies) were not
paused on. Everything they would have asked about is below.

**Short version:** every P0 and P1 feature is built and passes typecheck, lint, format and tests.
The app bundles for iOS (Metro + Hermes) and runs end to end in a browser build against the
offline server. **It has not run on an iPhone yet**: nothing in the build environment could
reach a phone or the production server. The device checks in step 3 are the open work.

## 1. What was built

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Plan | Plan, risks, open questions | Answers are in section 5 and `DECISIONS.md` (no separate plan doc) |
| M1 Skeleton + scoreboard | Expo SDK 58 app in the pnpm workspace, `@gridcast/types` + zod, scoreboard with pinned demo/featured cards, week picker, pull to refresh, 30 s refresh while live, API base override | Built. Bundles for iOS. **Device check pending** |
| M2 Game screen + stream | Catch-up then follow, scorebug, WP bar, LIVE/stale pill, play feed with streaming deltas, resilient SSE, background/foreground resume, offline banner | Built and tested against the fixture server. **Device check pending** |
| M3 Field | `react-native-svg` field, 22 players, LOS / first-down / red zone / end zones, all 10 templates plus generic | Built. GSAP parity test passes. **Smoothness check on device pending** |
| M4 Stoppages, playback, haptics | Stoppage cards (store timing), pause/step/next big play/Q4/speed 1-8x, scrubber, haptics | Built |
| M5 Announcers | Server TTS (expo-audio + expo-file-system) or device voice (expo-speech), muted by default, silent switch, stale skip | Built, queue unit-tested. **Audio check on device pending** |
| M6 Remaining P1 | Odds chart, analytics (EPA, 4th-down bot), chat with citation chips, preview, translation, room join + deep link, radio mode, each behind its flag | Built |
| M7 Polish + docs | Icon and splash (Gridcast mark), landscape full-field mode, safe areas, accessibility labels, README "iOS app" section, DECISIONS rows, `eas.json` | Built |
| P2 | Talk to the booth (dev build only), X clips (opens in browser), Live Activity plan | Code path, link-out and plan only (section 4) |

Files: `apps/mobile/app/*` (routes), `apps/mobile/src/*` (code), `apps/mobile/test/*` (tests),
`apps/mobile/docs/live-activity.md`. Root changes: `package.json` (`pnpm mobile`),
`vitest.config.ts` (mobile project), `eslint.config.js` (mobile rules + `@web` allowlist),
`.prettierignore`, `pnpm-lock.yaml`, `README.md`, `DECISIONS.md`. **No changes to
`apps/server`, `apps/web` or `packages/*`.** No new server endpoints were needed.

## 2. How it was checked here

- `pnpm check` (typecheck + lint + format + all tests) passes for the whole repo.
- 36 mobile unit tests (fixtures only, no network):
  - SSE parser: frames split at every byte size, CRLF / CR, multi-line data, comments, missing
    trailing newline, UTF-8 split across chunks.
  - `GameStream` against the real Hono app on fixtures: catch-up then follow, background/foreground
    resume with no duplicates, network failure then retry with `Last-Event-ID`, kill-switch
    `reset` restarting the replay, backoff sequence.
  - API client: bad cards and log entries are dropped, not fatal; bad optional blocks in game
    detail are dropped.
  - Field planner on all 187 demo-game plays plus synthetic plays for every template.
    **Parity test:** the web's real GSAP timelines, stepped at 120 fps, against the app's planner:
    every player within 0.44 SVG units (0.04 yd) at every 0.2 s sample, about 89,000 samples.
  - Announcer queue order, one voice at a time, stale skip, server/device fallback, mute.
  - Citation split / lookup, haptic mapping.
- `npx expo export --platform ios` bundles the app and compiles it to Hermes bytecode. That
  proves Metro resolves the monorepo, the `.ts` import specifiers in `@gridcast/types`, the
  `@web/*` alias and zod. The source map shows one React (19.3.0), one zustand, and only the 7
  allowlisted web files.
- A throwaway web build (react-native-web installed temporarily, **not committed**) ran in
  Chromium against `GRIDCAST_OFFLINE=1` server: scoreboard, demo replay animating, Q4 jump,
  analytics (chart, 4th-down bot, EPA), radio mode, preview countdown, settings and landscape all
  rendered with no page errors.
- The web app still builds and `pnpm smoke` passes (no console errors) after the lockfile change.

## 3. Steps you need to do

1. **Get the commits.** They are on your local `feat/mobile-ios` branch (not pushed, no PR).
   Run `git log --oneline -8` to see them.
2. **Install on the Mac:** `pnpm install` from the repo root (the lockfile changed). Don't reuse
   any `node_modules` copied from elsewhere.
3. **Device checks** (each one is something only a real iPhone can confirm):
   1. App Store **Expo Go must support SDK 58**. If it says the project is incompatible, update
      Expo Go.
   2. **M1:** `pnpm dev`, then `EXPO_PUBLIC_API_BASE=http://$(ipconfig getifaddr en0):8787 pnpm mobile`,
      scan the QR code. The scoreboard should load. Then run `pnpm mobile` with no env var: it
      should load from production. Also try the settings override (long-press GRIDCAST).
   3. **M2:** open the demo game. Background the app for 30 s and come back: no duplicate plays
      in the feed. Turn on airplane mode: the amber "Reconnecting" banner shows within a few
      seconds and clears when you turn it off. Watch one long live connection (10+ minutes) for
      stalls (open question 1).
   4. **M3:** play the demo replay at 1x and 4x. Look for smooth motion (target 60 fps on iPhone
      12+), no red screens, and a final play count equal to `/api/games/401873002/events` plays
      (187). If it stutters, see risk 1 below.
   5. **M5:** unmute with the ringer switch on silent. Announcers should be audible, never
      overlap, and skip lines that are 2+ plays stale. Check server TTS (when `ttsServer` is on in
      production) and the device voice (`FLAG_TTS` on, no ElevenLabs key locally).
   6. **M6:** restart the local server with flags off, e.g. `FLAG_CHAT=0 FLAG_TIMELINE=0
      FLAG_ODDS_CHART=0 FLAG_EPA=0 FLAG_FOURTH_DOWN=0 FLAG_PREVIEW=0 FLAG_TRANSLATE=0 pnpm dev`,
      and confirm each feature disappears. Chat and translation also need a Gemini or Anthropic
      key on the server to turn on at all.
   7. **Landscape:** rotate the phone on the game screen for the full-screen field. If Expo Go
      won't rotate, check that iPhone Portrait Orientation Lock is off.
   8. **Deep link:** in Expo Go use `exp://<laptop-ip>:8081/--/game/401873002?room=1`. The
      `gridcast://` scheme only works in a dev or standalone build.
4. **Run `npx expo-doctor`** in `apps/mobile` on the Mac. 18 of 20 checks passed here. The other
   two (config schema and React Native Directory) need the Expo API, which the build environment
   couldn't reach.
5. Nothing to clean up: the temporary transfer bundles in `data/cache/` were deleted after the
   commits were applied.
6. **TestFlight (optional):** needs an Expo account and an Apple Developer account. Run
   `npx eas-cli@latest init` in `apps/mobile` (it adds the project id), then
   `npx eas-cli@latest build --profile preview --platform ios`. Bundle id `com.gridcast.app`
   is a placeholder: change it in `app.json` if you own a different one. No build was run.
7. **Decide on dependencies** (none were added beyond §4 of the prompt):
   - `react-native-sse`: only if `expo/fetch` streaming proves unreliable on device (M2 check).
   - `expo-speech-recognition`: turns on Talk to the booth. Needs a development build
     (`npx expo install expo-speech-recognition`, then `eas build --profile development`).
   - `react-native-reanimated`: only if the field is too slow (risk 1).
   - `lucide-react-native` and `@gorhom/bottom-sheet`: not needed. The app uses Feather icons and
     a native page sheet.

## 4. Issues, deviations and risks

1. **The field animates on the JS thread, not with Reanimated worklets** (deviation from §3.4).
   The planner is a pure port of `animate.ts`, and a `requestAnimationFrame` loop samples it and
   re-renders the SVG, with players memoized on a 0.05-yard grid. Animating react-native-svg
   group transforms from the UI thread isn't reliable in Expo Go on the new architecture, and it
   couldn't be tried here. **Risk:** frame drops on older phones while the feed is also
   updating. If that happens, two fixes are available. The cheap one: render only involved
   players' names and drop to 30 fps sampling. The bigger one: move the driver to Reanimated with
   `useAnimatedProps` on `Circle cx/cy`, which is known to work, with the planner unchanged.
2. **Not run on a device or against production.** Neither the iPhone nor
   `gridcast-028f.fly.dev` was reachable from the build environment (proxy 403), so every device
   item in step 3 is unverified.
3. **Long-lived SSE on `expo/fetch`** (open question 1): stall detection is built in (no frame
   for 15 s, against the 5 s heartbeat, triggers a reconnect from `lastSeq + 1`). Whether iOS
   keeps a 10+ minute streaming body open in Expo Go is still untested.
4. **Small visual differences from the web field:**
   - Ball arcs use a quadratic curve through the same midpoint instead of GSAP's
     `curviness: 1.2` spline. Start and end points match.
   - After a touchdown the web leaves the end zone tinted at 20% for the rest of the game (GSAP
     `immediateRender`). The app clears it each play.
   - The web leaves the QB shrunk after a kneel. The app resets players' scale each play.
5. **Fonts inside the SVG field** use the registered expo-font names (`BarlowCondensed_700Bold`,
   `Geist_*`). If react-native-svg on device falls back to the system font for SVG text, it's
   cosmetic only (yard numbers and banners).
6. **Lockfile:** adding the app re-resolved some optional peers for the web (`react-is` 17 to
   19 for recharts, and terser / react-compiler peers for Vite). The package versions are the
   same. Web tests, `pnpm build` and `pnpm smoke` all pass.
7. **Translation** keeps requesting batches of 20 until every recent line is translated. The
   web hook stops after one batch until something changes.
8. **Join the room** reports "No room is showing this game right now" when no projector is
   hosting. The app never hosts a room (that stays on the web).
9. **Haptics:** penalties and missed kicks have no haptic, matching the web, which has no
   vibration for them either.
10. **Talk to the booth** is coded against the `expo-speech-recognition` API with a runtime
    check, but it's untested because the package isn't installed. In Expo Go the mic button never
    shows.
11. **X clips** show "Watch the clip on X" under the play (opens `expo-web-browser`) when the
    `clips` flag is on. There's no embed, per the prompt.
12. **Out of scope, as specified:** admin kill switch UI, accounts, push notifications, Android
    tuning, iPad-specific layouts, Access-mode sonification. iPad uses the phone layout.
13. **Live Activity / Dynamic Island:** plan only, in `apps/mobile/docs/live-activity.md`.
    Background updates would need a server change (APNs push), which is out of scope.
14. **No server or shared-type changes were needed or proposed.**

## 5. Open questions from the prompt (§7), answered

1. **expo/fetch SSE for long connections:** supported in SDK 58 (streaming body + Hermes
   `TextDecoder`). Silent stalls are caught by the 15 s no-frame watchdog. Long-run behavior on
   device is unverified (step 3.3).
2. **Import or port the store:** imported unchanged from `apps/web/src/store/game.ts`. Metro
   pins `zustand`/`react` to the app's copies, so there's one React.
3. **ATS for http LAN servers:** Expo Go allows them in development. `app.json` sets
   `NSAllowsLocalNetworking` for standalone builds, and production is https.
4. **Landscape:** a dedicated full-screen field with a compact score strip (pause and mute
   included). It's implemented that way.
5. **Bundle id / EAS:** `com.gridcast.app` placeholder. `eas.json` has `development`, `preview`
   and `production` profiles, and nothing was built.
