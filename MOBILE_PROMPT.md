# Build prompt: Gridcast iOS (React Native + Expo)

Paste this whole file to a coding agent working in the Gridcast repo, on branch `feat/mobile-ios`.

---

You are building **Gridcast Mobile**: an iOS app, written in React Native with Expo, that does what
the Gridcast web app does by hitting the **same server API**. The app lives at `apps/mobile` in the
existing pnpm monorepo. Read `PRD.md`, `AGENTS.md`, `DECISIONS.md` and this file before you plan.
`AGENTS.md` rules still apply unless this file overrides them.

## 0. Ground rules

1. **Do not change `apps/server`, `apps/web` or `packages/*`.** The web app is the hackathon demo,
   and it must stay identical. The server already sends `cors()` and works for native clients. If
   you think a server or shared-type change is needed, stop and ask. Write the proposal in
   `DECISIONS.md` and don't make it.
2. **Use the same API, with no new endpoints.** The mobile app calls only the Gridcast server. It
   never calls ESPN, Kalshi, X, ElevenLabs, Claude or Gemini directly, and no API keys go in the
   app.
3. **Expo Go first.** Every P0 and P1 feature must run in **Expo Go** on an iPhone. That means you
   can only use modules bundled in the Expo SDK, plus pure-JS libraries. Anything that needs a
   custom native module, such as speech recognition, is P2 and needs a development build. Keep it
   behind a runtime check so Expo Go never crashes.
4. **Use shared types, don't redefine them.** Import every API shape and zod schema from
   `@gridcast/types`. Validate every response and SSE message with those schemas using
   `safeParse`, and fail soft: log the bad message, skip it, and never crash.
5. **Feature flags come from the server.** `GET /api/games/:id` returns `features`. Hide anything
   whose flag is false or missing, the same way the web app does.
6. **Odds are information only.** Show the footer "Odds shown for information only. Not betting
   advice." on every screen with odds. Don't add bet buttons, picks or links to sportsbooks.
7. **Stop points** (wait for human review):
   - After your plan.
   - After milestone M1: the app boots in Expo Go and the scoreboard loads from the server.
   - After milestone M3: the demo replay plays start to finish on the field.
   - Before adding any dependency not listed in §4.
8. Use small commits with conventional messages (`feat(mobile): ...`) after each working step.
   Don't push and don't open a PR unless asked.

## 1. What already exists (read these first)

| You need | Read |
| --- | --- |
| API routes | `apps/server/src/app.ts`, `apps/server/src/routes/*.ts` |
| API shapes | `packages/types/src/api.ts`, `events.ts`, `analytics.ts`, `play.ts`, `state.ts`, `odds.ts`, `commentary.ts`, `clip.ts` |
| Team colors | `packages/types/src/teamColors.ts` |
| How the web consumes the API | `apps/web/src/lib/api.ts`, `apps/web/src/lib/stream.ts` |
| Game page state machine | `apps/web/src/store/game.ts` (zustand, no DOM) |
| Field math | `apps/web/src/field/geometry.ts`, `formations.ts`, `lineup.ts` (no DOM) |
| Animation templates | `apps/web/src/field/animate.ts` (GSAP: port it, don't import it) |
| Field rendering | `apps/web/src/field/Field.tsx` (SVG: port it to `react-native-svg`) |
| Announcer queue | `apps/web/src/lib/announcer.ts` |
| Chat, booth, citations | `apps/web/src/components/game/ChatDrawer.tsx`, `apps/web/src/lib/booth.ts` |
| Every game-page feature | `apps/web/src/routes/Game.tsx` |
| Design tokens | `apps/web/src/index.css` (`@theme` block) and `PRD.md` "Design system" |

### API contract (the only surface you use)

| Method | Route | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/api/health` | | `{ ok, offline }` |
| GET | `/api/games` | `?season=&week=` | `ScoreboardResponse` (demo game always pinned, `demo: true`; featured game has `featured: true`) |
| GET | `/api/games/:id` | | `GameDetail`: card, `source`, `state`, `rosters`, `depth`, `eventCount`, `features`, `preview` (pre-game only), `kalshiHomeProb` |
| GET | `/api/games/:id/events` | `?from=` | `EventsResponse { gameId, events: LoggedEvent[], next }` |
| GET | `/api/games/:id/stream` | `?from=&speed=` (0.25–16), header `Last-Event-ID` | **SSE.** `event: game` with `id: <seq>` and data `LoggedEvent`; `event: control` with data `StreamControl` (`reset` / `status` heartbeat every 5 s / `delta` commentary partials) |
| POST | `/api/games/:id/chat` | `ChatRequest { question, history? }` | **SSE over POST.** `event: chat` with data `ChatMessage` (`delta` / `tool` / `done` / `error`). 404 when chat is off |
| POST | `/api/tts` | `TtsRequest { text (≤400), voice: 'pbp' \| 'color' }` | `audio/mpeg` bytes; non-200 when TTS is off |
| POST | `/api/translate` | `TranslateRequest { lang: fr\|es\|de\|pt, texts[≤20] }` | `TranslateResponse` |
| GET | `/api/games/:id/room` | | `RoomResponse { source, seq?, speed }` (join the projector's replay in step) |
| GET | `/api/sfx/:name` | | `audio/mpeg` (touchdown roar etc.; may 404) |

The admin kill switch (`/api/admin/source`) is **out of scope** for the app. Operators use the web
`/admin` page for it.

Two behaviors you must reproduce exactly. Both are in `stream.ts` and `store/game.ts`:
- **Catch-up, then follow.** On open, fetch `/events`, apply every entry before `from` instantly
  with no animation, then open the stream at `from`. Live games start at the end of the log, and
  replays start at 0, or at the play given by `?from=` / room / timeline.
- **`control: reset`** means drop local state and restart. For live, restart at the end of the
  log. For replay, restart at `c.from`. This is how the kill switch flips a phone mid-game with no
  reload.

## 2. Scope

### P0 (the app is useless without these)

| # | Feature | Notes |
| --- | --- | --- |
| P0-1 | Scoreboard (home) | Cards for the week: teams with color marks, score, status detail, LIVE pill for live games, Kalshi or ESPN win %. Pinned demo and featured cards on top. Pull to refresh, plus auto-refresh every 30 s while any game is live. Week picker. |
| P0-2 | Game screen, live and final | Scorebug (score, quarter, clock, down and distance, ball on, possession, timeouts if in state), win-probability bar, LIVE/stale freshness pill driven by `status.lastUpdate` (stale after 60 s). |
| P0-3 | Animated field | Full port of `Field.tsx` and `animate.ts` to `react-native-svg` + `react-native-reanimated`. 22 team-colored players with jersey numbers, LOS (blue), first-down line (yellow), red-zone tint, end-zone colors, all 10 templates plus `generic`. A play animates in 3–6 s, and only one thing moves at a time (the queue in `store/game.ts`). Landscape gives a full-width field. Portrait puts the field on top and scrolls the panels below it. |
| P0-4 | Play feed | Newest first, commentary lines (pbp and color) under each play, live `delta` text while commentary streams, big-play badge, EPA chip when `features.epa`. Tap a play to replay its animation. |
| P0-5 | Stoppage cards | Timeout, injury, review, penalty, quarter end, two-minute, halftime. Same hold and TTL timing as the web store. |
| P0-6 | Resilient stream | SSE client with reconnect, backoff (1 s → 10 s), `Last-Event-ID` resume, and app background/foreground handling (close on background, resume from `lastSeq + 1` on foreground). An offline banner when it can't connect. |
| P0-7 | API base config | `EXPO_PUBLIC_API_BASE`, defaulting to production `https://gridcast-028f.fly.dev`. A hidden settings screen (long-press the logo) to override the base URL at runtime, for example a laptop's LAN IP, stored in `expo-secure-store` or AsyncStorage. |

### P1 (behind server flags, in this order)

| # | Feature | Flag | Notes |
| --- | --- | --- | --- |
| P1-1 | Playback controls | `timeline` | Pause/play, previous/next play, next big play, speed 1x/2x/4x/8x (`resume(speed)` reconnects from `lastSeq + 1`), scrubber over plays with big-play ticks. Replay only. |
| P1-2 | Announcers | `tts`, `ttsServer` | Port the `Announcer` queue. If `ttsServer` is set, POST `/api/tts`, write the bytes to a cache file with `expo-file-system`, and play it with `expo-audio`. Otherwise use `expo-speech`. Muted by default with an obvious unmute button. Set the audio session to play when the silent switch is on. Skip lines more than 2 plays stale. |
| P1-3 | Haptics | (always) | `expo-haptics` on outcomes from `lib/access.ts` `outcomeOf`: touchdown = success notification, turnover = heavy impact, first down = light impact, score = medium. A settings toggle, on by default. This is iOS's version of the web's Android vibration patterns. |
| P1-4 | Odds vs model chart | `oddsChart` | Hand-drawn `react-native-svg` line chart: Kalshi price vs model WP over plays, swing markers, plus a swing callout card for the last big swing. No chart library. |
| P1-5 | Analytics tab | `epa`, `fourthDown` | Team EPA, plus a 4th-down bot card (`fourthDown` / `nextFourthDown` on play events). |
| P1-6 | Ask the game | `chat` | Bottom sheet with a chat UI. POST SSE streaming, shows tool activity ("looking up plays…"), keeps 12 turns of history. A citation like `[Q3 4:12]` renders as a chip that jumps the field to that play (`firstCitation`). Answers can be read aloud with the color voice (`speakableAnswer`). |
| P1-7 | Preview screen | `preview` | For `status === 'pre'`: kickoff, venue, TV, spread/total, storylines, Kalshi price. |
| P1-8 | Translation | `translate` | Language picker (EN/FR/ES/DE/PT) that translates commentary lines in batches of 20. |
| P1-9 | Join the room | (always) | "Join the room" button on a game, which reads `/api/games/:id/room` and starts at its `seq` and `speed`. Also handle the deep link `gridcast://game/<id>?room=1`. |
| P1-10 | Radio mode | (always) | High-contrast, large-text view with no animation (port `RadioView.tsx`). Good for low battery and accessibility. |

### P2 (only if everything above is solid)

- Talk to the booth: speech-to-text needs `expo-speech-recognition`, so it requires a dev build.
  Show it only when the native module exists.
- X clips (`clip` events). Open the post URL in `expo-web-browser`. Don't embed a WebView.
- Live Activity or Dynamic Island scorebug. This is native work, so only write the plan for it.

### Out of scope

Admin kill switch, accounts, push notifications (no server support), Android polish (it should
build, but don't tune it), iPad layouts beyond "doesn't break", the access-mode Web Audio
sonification, and anything that needs a server change.

## 3. Architecture

```
apps/mobile/
  app.json                  # name "Gridcast", slug "gridcast", scheme "gridcast", dark UI, iOS bundle id
  package.json              # @gridcast/mobile, depends on @gridcast/types (workspace:*)
  metro.config.js           # monorepo: watchFolders = repo root, resolve workspace packages
  babel.config.js           # reanimated plugin (if the SDK still needs it)
  tsconfig.json             # extends expo/tsconfig.base, strict, paths for @/ and @web/
  app/                      # expo-router
    _layout.tsx             # fonts, dark theme, QueryClientProvider, SafeArea, Stack
    index.tsx               # scoreboard
    game/[id].tsx           # game screen (live / final / preview)
    settings.tsx            # API base override, haptics, language, about
  src/
    api/client.ts           # typed fetchers with zod safeParse (mirror apps/web/src/lib/api.ts)
    api/sse.ts              # tiny SSE parser over expo/fetch streaming (GET and POST)
    api/stream.ts           # GameStream: port of apps/web/src/lib/stream.ts on top of sse.ts
    store/                  # re-export of the web store (see §3.2), or a port if it won't import
    field/
      FieldView.tsx         # react-native-svg field, players, lines, ball
      plan.ts               # pure: PlayEvent + lineup -> keyframe tracks (port of animate.ts)
      usePlayAnimation.ts   # reanimated: drives `progress` 0..1, interpolates tracks on the UI thread
    audio/announcer.ts      # queue -> expo-audio (server TTS) or expo-speech
    haptics.ts
    components/             # Scorebug, WpBar, LivePill, PlayFeed, StoppageCard, OddsChart, ...
    theme.ts                # tokens from apps/web/src/index.css
```

### 3.1 Monorepo wiring

- Add `apps/mobile` to the workspace. It's already covered by `apps/*` in `pnpm-workspace.yaml`.
- Create the app with `pnpm create expo-app apps/mobile --template` (blank TypeScript), using the
  **current stable Expo SDK**. Record the SDK version in `DECISIONS.md`.
- Metro and pnpm: recent SDKs detect monorepos automatically. If Metro can't resolve hoisted or
  symlinked packages, try fixes in this order: (1) `metro.config.js` from Expo's monorepo guide,
  (2) `node-linker=hoisted` **scoped to `apps/mobile` only** if pnpm allows it. Do not switch the
  whole workspace's linker without asking, because it could break the web or server builds.
- `@gridcast/types` exports raw `.ts` source with explicit `.ts` import specifiers
  (`export * from './analytics.ts'`). **Check in M1 that Metro and Babel resolve these.** If not,
  fix it in `metro.config.js` (resolver `sourceExts` / `resolveRequest`), never by editing the
  package.
- zod v4 runs on Hermes. Check this in M1 by parsing a real `/api/games` response on device.
- Root scripts: add `"mobile": "pnpm --filter @gridcast/mobile start"`. Make sure root
  `pnpm typecheck` covers mobile and `pnpm lint` and `pnpm test` still pass. Add `apps/mobile` to
  ESLint and Vitest config only if they don't already cover it. **Don't** let mobile break
  `pnpm check`.

### 3.2 Reuse platform-free web code instead of copying it

These modules have no DOM dependencies, so import them as they are through a `@web/*` alias that
points at `apps/web/src/*` (set it in tsconfig `paths` and in Metro `resolveRequest`). Only
import from this allowlist:

- `@web/field/geometry`, `@web/field/formations`, `@web/field/lineup`
- `@web/lib/format`, `@web/lib/plays`
- `@web/lib/booth`: only `speakableAnswer` and `firstCitation`. Don't call `createRecognition`.
- `@web/lib/access`: only `outcomeOf`. If importing it pulls in DOM code at module load, port the
  function instead.
- `@web/store/game`: try it first. It's plain zustand plus types. If its `@/` imports don't
  resolve, port it to `src/store/game.ts`, keeping the logic **identical**.

Add a lint rule (`no-restricted-imports`) so nothing else under `@web/*` can be imported. Note in
`DECISIONS.md` that the cleaner long-term fix is to extract these into `packages/field` and
`packages/client` after the hackathon. Don't do that refactor now.

### 3.3 SSE on React Native

React Native has no `EventSource`. Write `src/api/sse.ts` (about 80 lines, no dependency) on top
of `fetch` from `expo/fetch`, which supports streaming response bodies:

- `openSSE({ url, method, body, headers, signal, onEvent(name, data, id), onOpen, onError })`
- Read `res.body.getReader()`, decode with `TextDecoder`, split frames on `\n\n`, and parse
  `event:`, `data:` (multi-line join with `\n`), `id:` and `retry:`. Ignore `:` comments.
- `GameStream` wraps it for GET streams and adds reconnect with backoff and `Last-Event-ID` (the
  server sends `id: <seq>` on every `game` event and honors the header).
- Chat uses the same parser with POST.
- Unit-test the parser with Vitest against recorded frames, including frames split across chunks,
  multi-line data and a missing trailing newline.
- If `expo/fetch` streaming turns out to be unreliable on device, the fallback is
  `react-native-sse`. That's a new dependency, so ask first.

### 3.4 Field animation (the hard part)

Don't use GSAP. Port `animate.ts` to a **pure planner** and an **animation driver**:

- `plan.ts`: `planPlay(play, lineup, orientation) -> { durationMs, tracks: Record<playerId,
  Keyframe[]>, ball: Keyframe[] (with z/arc height), events: { t, kind: 'flag'|'flash'|'banner'|... }[] }`.
  Here `Keyframe = { t: 0..1, x, y, ease? }`. Keep the same templates, timings and choreography as
  `animate.ts`: snap, handoff/dropback, route, ball arc, YAC, tackle convergence, flag drop, end-zone
  flash, possession flip.
- `usePlayAnimation.ts`: one Reanimated `useSharedValue(progress)` animated with
  `withTiming(1, { duration: durationMs / animSpeed })`. Each player is an `Animated` SVG `G`
  whose `transform` comes from `useAnimatedProps`, interpolating its track on the UI thread.
  When it finishes, `runOnJS(finishPlay)(playId)` advances the store queue exactly as the web
  does.
- Instant mode (catch-up and scrubbing) jumps to `progress = 1` with no animation.
- Field coordinates are the same as the web (1200 × 533 SVG units, tenths of a yard). Scale them
  with `viewBox` and `preserveAspectRatio="xMidYMid meet"`.
- Performance target: 60 fps on an iPhone 12 or newer with 22 players, the ball and labels. Labels
  (last names) only appear on involved players in portrait. Unit-test `plan.ts` with fixture plays
  from `data/fixtures` (every template, tracks monotonic in `t`, endpoints match `lineup` and the
  play's end spot).

### 3.5 Design

Follow the web tokens exactly. Put them in `src/theme.ts`:

| Token | Value |
| --- | --- |
| background | `#000000` |
| surface / raised | `#0e0e0e` / `#1a1a1a` |
| border | `#242424` |
| text / muted | `#ffffff` / `#8a8a8a` |
| live / stale | `#ff3b30` / `#ffb020` |
| first-down / scrimmage | `#ffd60a` / `#0a84ff` |
| positive / negative | `#30d158` / `#ff453a` |
| radius | 6 (8 for sheets) |

- Pure black, white text, and team colors are the only strong hues. No shadows. Use spacing
  instead of borders.
- Fonts: Geist for the UI and Barlow Condensed for display (scores, clock, headlines), loaded with
  `expo-font` / `@expo-google-fonts/*`. If there's no Geist package, bundle the font file. Scores
  and clocks use tabular numerals (`fontVariant: ['tabular-nums']`).
- iOS feel: large-title scoreboard, swipe-back, a bottom sheet for chat, a segmented control for
  Feed / Analytics / Radio on the game screen, safe areas everywhere, and the Dynamic Type scale
  respected in Radio mode.
- Dark mode only (`userInterfaceStyle: "dark"`), status bar light.
- Use `lucide-react-native` for icons to match the web (new dependency, ask first), or
  `@expo/vector-icons` (already in the SDK).

## 4. Allowed dependencies

These are pre-approved, so pin whatever versions `npx expo install` picks:

`expo`, `expo-router`, `react-native`, `react`, `react-native-svg`, `react-native-reanimated`,
`react-native-gesture-handler`, `react-native-safe-area-context`, `react-native-screens`,
`expo-audio`, `expo-speech`, `expo-haptics`, `expo-file-system`, `expo-font`,
`@expo-google-fonts/barlow-condensed`, `@expo-google-fonts/geist` (if it exists), `expo-linking`,
`expo-web-browser`, `expo-constants`, `expo-status-bar`, `expo-secure-store` or
`@react-native-async-storage/async-storage`, `@tanstack/react-query`, `zustand`, `zod`, and
`@gridcast/types` (`workspace:*`).

Ask before adding anything else, including `react-native-sse`, `lucide-react-native`, any chart
library, `@gorhom/bottom-sheet`, or `expo-speech-recognition`.

Always use `npx expo install <pkg>` so versions match the SDK.

## 5. Milestones

| # | Milestone | Verify (all of these must be true) |
| --- | --- | --- |
| M0 | Plan written | Plan lists files per milestone, risks, and answers to the open questions in §7. **Stop.** |
| M1 | Skeleton + scoreboard | `pnpm mobile` starts. The QR code opens the app in Expo Go on an iPhone. The scoreboard renders real `/api/games` data from production **and** from a LAN server (`EXPO_PUBLIC_API_BASE=http://<laptop-ip>:8787`). The `@gridcast/types` import and zod parse work on device. `pnpm check` is green. **Stop.** |
| M2 | Game screen + stream (no field yet) | Opening the demo game catches up from `/events`, then follows SSE. Scorebug, WP bar, LIVE pill and play feed update. Commentary `delta`s stream in. Backgrounding then foregrounding resumes without duplicates. Airplane mode shows the offline banner and then recovers. SSE parser tests pass. |
| M3 | Field | Demo replay (`401873002`) plays start to finish at 1x and 4x with every template appearing, no red screens, and no dropped plays (play count matches `/events`). Feels smooth on device. `plan.ts` tests pass. **Stop.** |
| M4 | Stoppages + playback + haptics | Stoppage cards appear with the web timing. Pause, step, next-big-play, speed and scrubber all work. Haptics fire on TD and turnover. |
| M5 | Announcers | Unmute plays server TTS when `ttsServer` is set, otherwise `expo-speech`. Voices never overlap, stale lines are skipped, and audio plays with the ringer switch on silent. |
| M6 | Remaining P1 | Odds chart, analytics, chat with citation jumps, preview, translation, room join + deep link, and radio mode, each hidden when its flag is off. Check this by running the server with `FLAG_CHAT=0` etc. |
| M7 | Polish + docs | App icon and splash (black, Gridcast mark from `apps/web/public/favicon.svg`), landscape field, safe areas on notch/Dynamic Island devices, accessibility labels on controls. Add an "iOS app" section to `README.md` (setup, env, running in Expo Go, LAN tips). `DECISIONS.md` updated. |

## 6. Testing and the definition of done

- **Unit tests (Vitest, no network):** SSE parser, `plan.ts`, API client schema handling (bad
  payloads are skipped and don't throw), announcer queue ordering and stale-skip logic (inject a
  fake player), and `[Q3 4:12]` citation-to-play lookup.
- **Fixtures only** in tests. Reuse `data/fixtures/` and recorded logs under `data/logs/` if
  present.
- **Device check on every milestone:** a real iPhone in Expo Go against (a) production and (b)
  `GRIDCAST_OFFLINE=1 pnpm dev` on the laptop over LAN. The iOS Simulator is fine during
  development, but it doesn't count for M3 or M5 (animation smoothness and audio).
- **Done means:** `pnpm check` passes for the whole repo, the demo replay runs with no LogBox
  errors or warnings, every server flag toggles its feature, and README and DECISIONS are updated.

## 7. Open questions for your plan (answer or flag them, don't guess silently)

1. Does the current Expo SDK's `expo/fetch` stream SSE reliably on device for long connections
   (more than 10 minutes, a full live quarter)? How do you detect a silent stall? (Use the 5 s
   `status` heartbeat: reconnect if nothing arrives for 15 s.)
2. Should `@web/store/game` be imported or ported? Decide in M1 after trying the import.
3. iOS App Transport Security for `http://` LAN servers. Expo Go allows it in development. For a
   standalone build, add `NSAllowsLocalNetworking` or require https.
4. Landscape: is a dedicated full-screen field mode better than rotating the whole layout?
   Recommend one.
5. A bundle identifier (`com.gridcast.app`?) and whether the team wants an EAS / TestFlight build.
   If yes, write `eas.json` with `development`, `preview` and `production` profiles, but don't run
   `eas build` without asking.

## 8. Running it (put this in the README at M7)

```bash
pnpm install
pnpm dev                                   # server :8787 (and web :5173)
# in another terminal
EXPO_PUBLIC_API_BASE=http://<your-laptop-LAN-IP>:8787 pnpm mobile
# scan the QR code with the iPhone Camera -> opens in Expo Go (same Wi-Fi as the laptop)

pnpm mobile                                # without the env var: uses production gridcast-028f.fly.dev
GRIDCAST_OFFLINE=1 pnpm dev                # server from fixtures, no ESPN/Kalshi needed
```

`localhost` on the phone is the phone itself, so always use the laptop's LAN IP. If the phone
and laptop can't see each other (campus Wi-Fi often isolates clients), use
`npx expo start --tunnel` for Metro and point `EXPO_PUBLIC_API_BASE` at production.
