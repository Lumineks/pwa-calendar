# contenteditable / ProseMirror / Tiptap Knowledge Base

Maintained by Compound V Phase 1B advisor. Append at the bottom on each pass.

---

## Updated 2026-08-27 — Tiptap on iOS Safari, IME/composition, non-Latin input

### Open, unfixed Tiptap bug worth designing around

**iOS/iPad Safari global page freeze after repeated text selection.** [ueberdosis/tiptap#7514](https://github.com/ueberdosis/tiptap/issues/7514), reported 2026-02-10 against Tiptap 3.0.0, **still open as of 2026-08-27**.

- Trigger: rapid select/deselect in the editor; some reporters say a single normal selection suffices.
- Effect: Safari enters a stuck "touch gesture in progress" state — **click synthesis stops working page-wide**, `:hover` sticks on `<html>`, `touchstart`/`touchend` still fire. Survives unmounting the editor. Only a full reload recovers.
- Ineffective workarounds: removing listeners, clearing the selection.
- Effective workaround: bind handlers to `touchend`/`pointerup` instead of `click`.

**Reusable rule:** on iOS, any UI that asks the user to *select text, then tap a control* (toolbars, colour pickers, formatting bars) must use `pointerup`/`touchend`, not `click`. Treat "select then tap" flows as high-risk on iOS and always device-test them.

Evidence quality: one high-quality open issue with multiple reporters. **Not** a broad community consensus signal.

### Composition / IME — the rules that matter for non-Latin input

Predictive text and autocorrect on iOS make composition the *normal* typing path for languages like Russian, not an edge case.

Documented failure modes:
- iOS Safari fires **duplicate** composition-related `beforeinput`/`input` events.
- Forcing a DOM update on an event whose `inputType` is null/undefined breaks model–DOM sync; subsequent characters land in the wrong position. [contenteditable lab ce-0584](https://contenteditable.realerror.com/cases/ce-0584-ios-safari-inputtype-null-forced-render-breaks-sync/).
- Diacritics/multi-char sequences can be lost, reordered, or split across DOM nodes when the editor normalizes or wraps text mid-composition.
- With IMEs, `beforeinput` + `preventDefault` is not reliably preventable. [w3c/input-events#86](https://github.com/w3c/input-events/issues/86), [MDN beforeinput](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/beforeinput_event).

**Reusable rules:**
1. Guard every *programmatic* content write (`setContent`, external sync, collaborative patch) on `editor.view.composing === false`. Defer to `compositionend`.
2. **`isFocused` is not a substitute for `composing`.** A background update can land while the editor is focused-but-idle *and* mid-composition.
3. Debounced serialization (`getHTML()`) during composition can capture half-formed words. Reset the debounce on `compositionstart`.
4. `autocorrect` / `autocapitalize` attributes are reported to have **no effect on contenteditable** in iOS Safari — "just disable autocorrect" is not an available mitigation. ([davidwalsh](https://davidwalsh.name/disable-autocorrect), corroborated by contenteditable lab scenarios.)

### Caret / selection on iOS

- Caret and selection can render in the *hidden* portion of a scrollable `contenteditable`, and the keyboard covers the line being typed with no auto-scroll. [tiptap#2629](https://github.com/ueberdosis/tiptap/issues/2629).
- iOS Safari does not hide the caret for non-textual selections (e.g. `NodeSelection`). [discuss.ProseMirror](https://discuss.prosemirror.net/t/ios-safari-does-not-hide-the-caret-on-non-visible-selections-e-g-nodeselection/3024).
- Always device-test "type near the bottom of a long document".

### Cross-platform: ProseMirror `scrollToSelection`

On Android Chrome, an editor near the bottom of the page can scroll the page to the top on first keystroke: after dispatch, ProseMirror's `scrollToSelection` uses `visualViewport.width/height` when available, and the coordinate systems disagree with `getBoundingClientRect` because Chrome shrinks the layout viewport for the keyboard. On iOS Safari the layout viewport is *not* shrunk, `moveY` computes to ~0, and the jump does not occur. `focus({preventScroll:true})` helps the focus path but not the typing path. [tiptap#7757](https://github.com/ueberdosis/tiptap/issues/7757).

**Reusable rule:** keyboard/viewport code must branch on platform; iOS and Android Chrome have opposite viewport behaviours.

### Zoom floor

Computed font-size < 16 px on a contenteditable → iOS zooms the viewport on focus, exactly as for `<input>`. See `ios-pwa-safari.md`.

### Storage format

**Reusable rule:** when migrating a field from plain text to rich HTML in place, store an explicit format marker. Prefix heuristics ("starts with `<p>`") are unfixable once ambiguous content exists — and content that *legitimately* contains angle brackets will exist as soon as a user pastes something.
