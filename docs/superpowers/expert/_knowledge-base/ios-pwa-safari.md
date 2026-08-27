# iOS PWA / Safari Knowledge Base

Maintained by Compound V Phase 1B advisor. Append at the bottom on each pass.

---

## Updated 2026-08-27 — standalone PWA: storage, gestures, keyboard, splash

### Storage model matrix (iOS)

| Context | localStorage / IndexedDB / SW | Shared with? | Wiped by |
|---|---|---|---|
| Safari tab | own store | nothing | 7-day script-writable-storage cap if site unused; Clear History & Website Data; low-disk eviction |
| Home-screen web app (standalone) | **separate** store | nothing — **not** shared with Safari | own use-counter (resets on use, so the 7-day cap effectively does not apply); Clear History & Website Data; low-disk eviction; **deleting and re-adding the icon** |

Sources: [WebKit b/181849](https://bugs.webkit.org/show_bug.cgi?id=181849), [Apple forums 710157](https://developer.apple.com/forums/thread/710157), [Netguru](https://www.netguru.com/blog/how-to-share-session-cookie-or-state-between-pwa-in-standalone-mode-and-safari-on-ios), [magicbell 2026 guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide).

**Reusable rule:** any credential or user-set preference established in Safari is *gone* the moment the user installs to Home Screen. Design install-then-auth, never auth-then-install. Never make a home-screen PWA the only copy of a credential.

**Reusable rule:** there is no `navigator.storage.persist()` guarantee on iOS. Client storage is a cache, never a system of record.

### Install / standalone detection

```js
const standalone = window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;
```
`matchMedia('(display-mode: standalone)')` works iOS 13+ but is reported unreliable (breaks in fullscreen, inconsistent across platforms); `navigator.standalone` is the canonical iOS signal and is under W3C discussion for standardization. UA sniffing is a poor primary gate — iPadOS reports as macOS. Sources: [web.dev detection](https://web.dev/learn/pwa/detection), [magicbell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide).

Note: neither signal distinguishes "not installed" from "installed, but the user opened the link in Safari".

### Navigation gestures

- Home-screen web apps have back/forward swipe gestures and **no visible back button** — the gesture is the only back affordance.
- The system gesture fires *in addition to* app-level navigation → double-back. Documented repeatedly in Ionic's tracker: [#22299](https://github.com/ionic-team/ionic-framework/issues/22299), [#29733](https://github.com/ionic-team/ionic-framework/issues/29733).
- **There is no manifest opt-out.** [w3c/manifest#1041](https://github.com/w3c/manifest/issues/1041) is still open. WKWebView apps can disable it; installed web apps cannot.
- **The only reliable suppression:** `preventDefault()` on `touchstart`, supported since iOS Safari 13.4 ([pqina](https://pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4/)). Safari registers `touchstart` as `passive: true` by default → the listener MUST be added with `{ passive: false }` or the call is a silent no-op.
- Note also: preventing `touchmove` once disables scrolling for the whole touch duration ([Apple handling-events guide](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html)).
- **No published width exists for WebKit's edge-gesture region.** "N px dead zone" numbers circulating in blog posts are folklore. Treat any inset as an unverified device-test assumption. (UIKit's `preferredScreenEdgesDeferringSystemGestures` is a different mechanism and does not apply to web content.)
- iOS 26: Safari Compact layout added a **right-edge swipe-forward** gesture, so both edges are contended, not just the left ([Safari 26 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes)).

### Keyboard / viewport

- **Standalone-PWA bug:** after keyboard dismissal `visualViewport.offsetTop` does not reset to 0 → `position: fixed` / `sticky` elements sit misaligned; the standalone viewport can stay shrunk. CSS-only fixes are ineffective; JS `visualViewport` listeners are the workaround. Sources: [dev.to cederhook](https://dev.to/cederhook/fixing-the-ios-standalone-pwa-keyboard-bug-that-shrinks-your-viewport-for-good-63d), [Apple forums 744327](https://developer.apple.com/forums/thread/744327), [contenteditable lab](https://contenteditable.realerror.com/scenarios/scenario-ios-viewport-keyboard/).
- `focusout` is a better "keyboard about to dismiss" signal than `resize`.
- Unlike Android Chrome, iOS Safari does not shrink the layout viewport for the keyboard; `getBoundingClientRect` stays aligned with `visualViewport`. Cross-platform viewport math must branch.
- **Reusable rule:** never animate layout while the keyboard is dismissing. Blur → wait for viewport quiet → animate.
- **Reusable rule:** avoid `position: fixed` and `100vh` in any surface that hosts a text input on iOS.

### 16 px zoom floor

Computed rendered font-size < 16 px on a focusable text surface → Safari zooms the viewport on focus. Applies to `<input>`, `<textarea>`, **and contenteditable surfaces (ProseMirror, CodeMirror, Slate)**. Threshold is the computed size *after transforms*, so `transform: scale(k); font-size: 16px` is the sanctioned escape hatch. `user-scalable=no` is ignored by iOS for accessibility. Source: [CSS-Tricks](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/), [defensivecss](https://defensivecss.dev/tip/input-zoom-safari/).

### Splash screens

- iOS has **no manifest-driven splash**. `<link rel="apple-touch-startup-image">` remains the only mechanism, one tag per device resolution × orientation, optionally × `prefers-color-scheme`. Sources: [Apple forums 733490](https://developer.apple.com/forums/thread/733490), [web.dev enhancements](https://web.dev/learn/pwa/enhancements).
- `pwa-asset-generator` (elegantapp) is still the standard tool; dark-mode variants supported, light declared before dark ([issue #51](https://github.com/elegantapp/pwa-asset-generator/issues/51)).
- **Pitfall — silent failure:** a resolution with no matching tag, or an href that 404s, produces a blank white splash with no error. Always verify the images actually resolve.
- **Pitfall — subpath deployments:** generators emit root-relative `/apple-splash-*.png`. Under GitHub Pages project sites (`/repo/`) these 404. Rewrite hrefs to the deployment base.
- **Pitfall:** emit both light and dark media variants even in a light-only app, so every device matches something.
- Periodic "stopped working on iOS X" reports (e.g. iOS 16.4 in the Apple forums thread) generally resolve to missing resolutions rather than removed platform support. **As of 2026-08-27 I found no positive confirmation for iOS 18/26 and no evidence of removal — status: verify on device.**
- iOS 17 bug: colour-scheme changes did not apply to installed PWAs without restarting the app; fixed in iOS 18.

### Service worker update timing

On iOS a standalone PWA's SW update typically activates only on a full app cold start, which may be days after deploy. Any client-side migration or version-gated behaviour must be triggered by client-side version detection, never assumed to coincide with server deploy.
