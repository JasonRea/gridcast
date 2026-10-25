# Gridcast on Meta Ray-Ban Display glasses

Goal: show the live game (and the demo replay) on Meta Ray-Ban Display glasses during judging,
without a laptop.

## Approach (no Swift changes)

The PianoEye iOS app (see `meta-glasses-display-guide.md`, section 5) is a WKWebView shell that
lets any https page drive the glasses through `window.webkit.messageHandlers.eye.postMessage`.

1. Add `apps/web/public/glasses.html` (static, served by the existing Fly deploy at
   `https://gridcast-028f.fly.dev/glasses.html`).
2. The page reads a game from the existing API (`/api/games/:id`, `/api/games/:id/stream` SSE,
   `/api/games/:id/room` to follow the director screen) and, for every play, renders a 600x600
   card on a canvas: score, quarter + clock, down & distance, a mini field with the ball spot and
   first-down line, and the commentary line (in the chosen language via `/api/translate`).
   Black background = transparent on the glasses; bright text only.
3. Sends each card with `eye({cmd:"displayImage", d: base64, id})` and waits for the
   `displaySent` event before sending the next one (each send replaces the whole view).
4. Tap on the glasses (`tap` event) cycles views: play card / scoreboard / win probability.
5. On-phone controls: game picker (live featured game or demo replay), language, follow-room
   toggle, buttons to `register` and `displayStart`, and a preview of the card in the page so it
   can be tested in any browser without glasses.
6. In PianoEye, load the page once with `eye({cmd:"loadURL", url:"https://gridcast-028f.fly.dev/glasses.html", persist:true})`.

## Known limits

- PianoEye must already be installed on the iPhone (free Apple ID installs expire after 7 days;
  reinstalling needs Xcode on a Mac).
- Merging to `main` deploys to Fly via `.github/workflows/deploy.yml` (needs the `FLY_API_TOKEN`
  repo secret).
