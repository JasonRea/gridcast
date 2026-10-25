# Showing things on Meta Ray-Ban Display glasses from an iPhone app (Meta DAT SDK)

Distilled from the working **PianoEye-ios** project (`~/Downloads/PianoEye-ios (5).zip`), which builds and runs on a real iPhone + Meta Ray-Ban Display glasses. Everything below is copied from code that compiled and worked; anything not in that project is marked **(unverified)**.

## TL;DR

- SDK: **Meta Wearables Device Access Toolkit (DAT) 1.0.1**, Swift package `https://github.com/facebook/meta-wearables-dat-ios`, **exact version 1.0.1**. iOS deployment target 17.2, Swift 5 language mode.
- Libraries: `MWDATCore` (always) + `MWDATDisplay` (drawing on the glasses). Optional: `MWDATInputs` (touchpad/Neural Band), `MWDATCamera`, `MWDATMotion`.
- The phone draws the glasses UI. Flow: `Wearables.configure()` → register through the Meta AI app → `createSession` → `session.addDisplay()` → `display.start()` → wait for `.started` → `display.send(FlexBox { Text(...) / Image(...) })`.
- **Each `send` replaces the whole glasses view.**
- The glasses **can't open a web link themselves**. To "display a website link", show the URL as text and/or a **QR code image**, and open the URL **on the phone** when the user taps the glasses (`.onTap` → `UIApplication.shared.open(url)`).

---

## 1. One-time setup

**Meta AI app (on the iPhone):** turn on Developer Mode (Settings → App Info → tap the version number 5 times). Then Developer Mode → **Install** the toolkit on the glasses. With Developer Mode on, you don't need a MetaAppID or ClientToken; those fields stay empty.

**Xcode:** File → Add Package Dependencies → `https://github.com/facebook/meta-wearables-dat-ios`, set Dependency Rule to **Exact Version 1.0.1**, and link `MWDATCore` and `MWDATDisplay` (add `MWDATInputs` if you need glasses input).

**Info.plist**: these keys are required. The URL scheme (here `myapp`) is how the Meta AI app returns to your app after registration.

```xml
<key>CFBundleURLTypes</key>
<array><dict>
  <key>CFBundleTypeRole</key><string>Editor</string>
  <key>CFBundleURLName</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleURLSchemes</key><array><string>myapp</string></array>
</dict></array>

<key>MWDAT</key>
<dict>
  <key>AppLinkURLScheme</key><string>myapp://</string>
  <key>MetaAppID</key><string>$(META_APP_ID)</string>   <!-- empty is fine in Developer Mode -->
  <key>ClientToken</key><string>$(CLIENT_TOKEN)</string> <!-- empty is fine in Developer Mode -->
  <key>TeamID</key><string>$(DEVELOPMENT_TEAM)</string>
</dict>

<!-- Glasses Bluetooth channel. Meta's docs leave this out (issue #268 on their repo), but free Apple IDs need it -->
<key>UISupportedExternalAccessoryProtocols</key>
<array><string>com.meta.ar.wearable</string></array>
<key>LSApplicationQueriesSchemes</key>
<array><string>fb-viewapp</string></array>
<key>UIBackgroundModes</key>
<array>
  <string>bluetooth-central</string>
  <string>bluetooth-peripheral</string>
  <string>external-accessory</string>
</array>
<key>NSBluetoothAlwaysUsageDescription</key><string>Needed to connect to your Meta glasses</string>
<key>NSBluetoothPeripheralUsageDescription</key><string>Needed to connect to your Meta glasses</string>
<key>NSLocalNetworkUsageDescription</key><string>Lets your phone find and connect to your glasses.</string>
<key>NSBonjourServices</key><array><string>_bonjour._tcp</string></array>
```

**Entitlements:** only `keychain-access-groups` = `$(AppIdentifierPrefix)$(CFBundleIdentifier)`. You don't need the Hotspot or Wi-Fi entitlements, which are paid-account only anyway.

---

## 2. Important gotchas

1. **Keep `MWDATDisplay` and `MWDATCamera` in separate Swift files.** Both declare `VideoCodec`, so importing them in the same file fails to compile. PianoEye gives each capability its own file: `GlassesDisplay.swift` imports only `MWDATCore + MWDATDisplay + UIKit`, and `GlassesViews.swift` imports only `MWDATDisplay + UIKit`.
2. **Call `display.send` only after the display state is `.started`.** Sending earlier throws an error.
3. **Every send replaces the entire view**, so the screen shows one view at a time. Wait for each `send` to finish before starting the next one.
4. **Black pixels are transparent** on the glasses. Use bright content on a black background.
5. **While a DAT session runs, the glasses suspend their own web apps.** Draw everything through the Display API.
6. Subscribe to `statePublisher` **before** calling `start()`, or you can miss state changes.
7. Keep the listener tokens (`ListenerTokenBag`, or the returned token) alive. When a token is released, its callbacks stop.
8. Image size: PianoEye sends 600×600 images using `Image(image:, sizePreset: .fill, cornerRadius: .medium)`.

---

## 3. Minimal native code

### App entry: configure the SDK and handle the Meta AI callback

```swift
import MWDATCore
import SwiftUI

@main
struct MyApp: App {
  @State private var glasses: Glasses

  init() {
    do { try Wearables.configure() } catch { NSLog("Wearables.configure failed: \(error)") }
    _glasses = State(wrappedValue: Glasses(wearables: Wearables.shared))
  }

  var body: some Scene {
    WindowGroup {
      ContentView(glasses: glasses)
        .onOpenURL { url in glasses.handleOpenURL(url) }   // Meta AI app returns here
    }
  }
}
```

### Registration and session (`Glasses.swift`: `MWDATCore` only)

```swift
import MWDATCore
import UIKit

@MainActor
final class Glasses {
  private let wearables: WearablesInterface
  private let deviceSelector: AutoDeviceSelector
  private var session: DeviceSession?
  private let sessionTokens = ListenerTokenBag()
  let display = GlassesDisplay()
  var onSessionStarted: (() -> Void)?

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.deviceSelector = AutoDeviceSelector(wearables: wearables)
    Task { for await s in wearables.registrationStateStream() { NSLog("registration: \(s)") } }
  }

  /// Step 1: opens the Meta AI app (only needed once per bundle id).
  func register() {
    Task { try? await wearables.startRegistration() }
  }

  func handleOpenURL(_ url: URL) {
    guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
          c.queryItems?.contains(where: { $0.name == "metaWearablesAction" }) == true else { return }
    Task { _ = try? await Wearables.shared.handleUrl(url) }
  }

  /// Step 2: session -> display.
  func startSession() {
    guard session == nil else { return }
    do {
      let s = try wearables.createSession(deviceSelector: deviceSelector)
      session = s
      s.statePublisher.listen { [weak self] state in
        Task { @MainActor in
          guard let self else { return }
          if state == .started {
            try? self.display.attach(s)      // add + start the display
            self.onSessionStarted?()
          }
          if state == .stopped { self.session = nil; self.display.reset(); self.sessionTokens.clear() }
        }
      }.store(in: sessionTokens)
      s.errorPublisher.listen { error in NSLog("session error: \(error)") }.store(in: sessionTokens)
      try s.start()
    } catch {
      NSLog("couldn't start session: \(error)")
      session = nil
    }
  }

  func endSession() { session?.stop() }
}
```

### Display wrapper (`GlassesDisplay.swift`: `MWDATCore + MWDATDisplay + UIKit`, mostly PianoEye's code)

```swift
import MWDATCore
import MWDATDisplay
import UIKit

@MainActor
final class GlassesDisplay {
  var onReady: (() -> Void)?
  var onTap: (() -> Void)?
  private var display: Display?
  private var token: Any?
  private(set) var ready = false

  func attach(_ session: DeviceSession) throws {
    guard display == nil else { return }
    let d = try session.addDisplay()
    token = d.statePublisher.listen { [weak self] newState in
      Task { @MainActor in
        guard let self else { return }
        self.ready = newState == .started
        if newState == .started { self.onReady?() }
        if newState == .stopped { self.display = nil; self.token = nil }
      }
    }
    display = d
    d.start()
  }

  func reset() { display = nil; token = nil; ready = false }

  func sendText(_ text: String) async throws {
    guard let d = display, ready else { return }
    try await d.send(GlassesViews.text(text) { [weak self] in Task { @MainActor in self?.onTap?() } })
  }

  func sendImage(_ image: UIImage) async throws {
    guard let d = display, ready else { return }
    try await d.send(GlassesViews.image(image) { [weak self] in Task { @MainActor in self?.onTap?() } })
  }
}
```

### Views (`GlassesViews.swift`: `MWDATDisplay + UIKit` only, copied from PianoEye)

```swift
import MWDATDisplay
import UIKit

enum GlassesViews {
  static func image(_ image: UIImage, onTap: @escaping @Sendable () -> Void) -> FlexBox {
    FlexBox(direction: .column) {
      Image(image: image, sizePreset: .fill, cornerRadius: .medium)
    }
    .onTap { onTap() }
  }

  static func text(_ text: String, onTap: @escaping @Sendable () -> Void) -> FlexBox {
    FlexBox(direction: .column) {
      Text(text, style: .heading)
    }
    .onTap { onTap() }
  }
}
```

PianoEye only uses `FlexBox(direction: .column)`, `Text(_, style: .heading)`, `Image(image:, sizePreset: .fill, cornerRadius: .medium)` and `.onTap`. For other components or styles, see Meta's **DisplayAccess** and **CarMaintenanceDisplay** sample apps in the same GitHub repo **(unverified beyond these)**. PianoEye's imports and signatures follow those samples on purpose.

---

## 4. Recipe: show a website link

The glasses don't have a browser through DAT, so do this instead:

1. Draw the URL and a QR code into one image on the phone and send it with `sendImage` (a single image avoids the one-view-per-send limit).
2. Tapping the glasses (`onTap`) opens the link on the phone.

```swift
import CoreImage.CIFilterBuiltins
import UIKit

/// 600x600 black canvas (black = transparent on the glasses) with a title, a QR code and the URL.
func linkCard(url: String, title: String) -> UIImage {
  let size = CGSize(width: 600, height: 600)
  let qr: UIImage? = {
    let f = CIFilter.qrCodeGenerator()
    f.message = Data(url.utf8)
    f.correctionLevel = "M"
    guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
          let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
    return UIImage(cgImage: cg)
  }()
  return UIGraphicsImageRenderer(size: size).image { ctx in
    UIColor.black.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
    let para = NSMutableParagraphStyle(); para.alignment = .center
    (title as NSString).draw(in: CGRect(x: 20, y: 20, width: 560, height: 60), withAttributes: [
      .font: UIFont.boldSystemFont(ofSize: 40), .foregroundColor: UIColor.white, .paragraphStyle: para])
    // White-backed QR so it scans (the white area is what you'll see on the glasses).
    let qrRect = CGRect(x: 150, y: 100, width: 300, height: 300)
    UIColor.white.setFill(); ctx.fill(qrRect.insetBy(dx: -12, dy: -12))
    qr?.draw(in: qrRect)
    (url as NSString).draw(in: CGRect(x: 20, y: 440, width: 560, height: 140), withAttributes: [
      .font: UIFont.systemFont(ofSize: 30), .foregroundColor: UIColor.white, .paragraphStyle: para])
  }
}

// Usage, once the display is ready:
let link = "https://example.com"
glasses.display.onTap = { if let u = URL(string: link) { UIApplication.shared.open(u) } }
glasses.display.onReady = {
  Task { try? await glasses.display.sendImage(linkCard(url: link, title: "Open on phone")) }
}
glasses.startSession()
// Text-only alternative: try await glasses.display.sendText("example.com")
```

The QR code is useful for showing the link to someone else, or for scanning with another device. It's hard to scan from a see-through HUD, so treat the tap-to-open-on-phone as the main action.

---

## 5. Shortcut: reuse the PianoEye app with no Swift changes

PianoEye is a WKWebView shell. Any page it loads can drive the glasses through JavaScript:

```js
const eye = (m) => window.webkit.messageHandlers.eye.postMessage(m);
eye({cmd: "register"});                         // first time only
eye({cmd: "displayStart"});                     // starts the session + display
eye({cmd: "displayText", text: "example.com"});
eye({cmd: "displayImage", d: base64PngOrJpeg, id: 1}); // 600x600 recommended; wait for "displaySent" before the next send
eye({cmd: "openURL", url: "https://example.com"});     // opens on the phone
// Events from the app: window.eye = { _state(s){}, _log(m){}, _frame(f){}, _event(name, data){} }
//   _event("displayState", {state}), _event("displaySent", {id, ok}), _event("tap", {})
```

Point the app at your own page in one of two ways:
- Change `defaultPageURL` in `PianoEye/EyeWebView.swift:14` and rebuild.
- From the current page, send `eye({cmd:"loadURL", url:"https://your.page", persist:true})` (https only).

Define `window.eye` in your page so the `_state`, `_event` and other callbacks have somewhere to land.

## 6. Reference files in the zip

- `PianoEye/GlassesDisplay.swift`: display attach, state and send
- `PianoEye/GlassesViews.swift`: FlexBox, Text and Image views
- `PianoEye/EyeBridge.swift`: registration, session, JS command bridge, camera
- `PianoEye/GlassesInputs.swift`: touchpad and Neural Band input (`session.addInputs(configuration: InputsConfiguration(sources: [.captouch, .neuralBand, .captureButton, .actionButton, .neuralBandDrag]))`)
- `Support/Info.plist`, `Support/PianoEye.entitlements`
