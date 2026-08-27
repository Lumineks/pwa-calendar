# Tiptap Library Knowledge Base

Maintained by Compound V Phase 1C validator. Append at the bottom.

---

## Updated 2026-08-27 — v2 rich text (colour-only editor)

Sources: `registry.npmjs.org` direct queries; published tarball `.d.ts` inspection of
`@tiptap/*@3.30.5`; `tiptap.dev/docs/editor/getting-started/install/svelte`;
GitHub issues ueberdosis/tiptap#7514, #7540, #2629.

**Current line (2026-08-27): 3.30.5, released 2026-08-26.** dist-tags also carry
`v2-latest: 2.27.2`, `beta: 3.0.2-beta.0`. Release cadence is near-daily. Not deprecated,
not archived.

**Package reorganisation in v3 — verified by reading the shipped dists, not docs:**

- `@tiptap/extension-history@3.30.5/dist/index.js` is a two-line shim:
  `import { UndoRedo, UndoRedo as History } from "@tiptap/extensions"`.
  Real home: **`UndoRedo` from `@tiptap/extensions`**. Options type `UndoRedoOptions`
  (`depth` default 100, `newGroupDelay` default 500). Command namespace renamed
  `history` → `undoRedo`; the `undo()` / `redo()` commands themselves are unchanged.
- `@tiptap/extension-color@3.30.5/dist/index.js` is a shim:
  `import { Color } from "@tiptap/extension-text-style"`.
  Real home: **`Color` from `@tiptap/extension-text-style`**. Commands unchanged:
  `setColor(color: string)`, `unsetColor()`.
- `@tiptap/extension-text-style` also exports `BackgroundColor`, `FontFamily`, `FontSize`,
  `LineHeight`, and `TextStyleKit` (all-in-one, each sub-extension disable-able with `false`).
- `@tiptap/extensions` also carries `CharacterCount`, `Dropcursor`, `Focus`, `Gapcursor`,
  `Placeholder`, `Selection`, `TrailingNode`.
- `Document`, `Paragraph`, `Text` remain standalone packages.

**Peer dependencies are EXACT-pinned, not ranged** (2026-08-27):
`@tiptap/core@3.30.5` → `{"@tiptap/pm": "3.30.5"}`; `@tiptap/extensions@3.30.5` →
`{"@tiptap/pm": "3.30.5", "@tiptap/core": "3.30.5"}`; extension packages → `{"@tiptap/core": "3.30.5"}`.
Consequence: `^3.x` ranges across several `@tiptap/*` entries drift apart on reinstall and
throw `ERESOLVE`. **Pin all `@tiptap/*` to one identical exact version and declare `@tiptap/pm`
explicitly** — it is a peer, so npm 7+ auto-installs it but nothing pins it.

**Measured bundle cost** (2026-08-27, esbuild `--bundle --minify --format=esm`, `gzip -9`,
`@tiptap/*@3.30.5`):

| Set | raw | gzip |
|---|---|---|
| Document+Paragraph+Text+TextStyle+Color+UndoRedo | 311,209 B | **95,480 B** |
| same minus UndoRedo | 286,299 B | 87,583 B |
| `new Editor({extensions: []})` — ProseMirror floor | 279,999 B | **86,140 B** |

Load-bearing conclusion: **~90% of Tiptap's weight is the ProseMirror floor and is not
reachable by trimming extensions.** Dropping UndoRedo recovers 8.3%. Any plan that budgets
"40–60 KB gzip for a minimal Tiptap" is wrong by ~2x. Treat 86 KB gzip as the entry price for
Tiptap/ProseMirror at all.

**Svelte integration (2026-08-27):** Tiptap publishes **no** official Svelte package
(`@tiptap/svelte` → 404 on npm). The official Svelte guide now covers Svelte 5 runes and
recommends `@tiptap/core` directly. Pattern: `let editorState = $state({ editor: null })`,
reassigned (not mutated) from `onTransaction` — the `Editor` instance is not deeply reactive.
Construct inside `onMount`/`$effect`; it touches `document`.
Third-party `svelte-tiptap@3.0.1` (2025-10-28) works with Tiptap 3 + Svelte 5 but peer-requires
`@tiptap/extension-bubble-menu`, `@tiptap/extension-floating-menu`, `@floating-ui/dom`; its npm
description still says "tiptap v2". Skip it unless you actually want bubble/floating menus.

**Open iOS Safari issues in the 3.x line (2026-08-27):**

- **#7514 — global page freeze after text selection. OPEN, filed 2026-02-10, no maintainer fix.**
  After selecting text in the editor, all `click` events *outside* the editor stop firing globally;
  `:hover` sticks on `<html>`; `touchstart`/`touchend` keep working; survives editor unmount;
  only a reload recovers. Reporter: "a single normal text selection already caused their page to
  freeze" for some users. Partial workaround: bind `touchend` instead of `click`. Failed
  workarounds: removing listeners, `getSelection().removeAllRanges()`.
  **This is a hard hazard for any select-text-then-tap-a-toolbar-button UI on iOS.**
- #7540 — iOS keyboard ▲/▼ navigation arrows always disabled with multiple Tiptap fields (3.20.0).
- #2629 — caret and selection render outside the clip in `overflow-y: auto` contenteditable on
  iOS Safari.

`TextStyleOptions.mergeNestedSpanStyles` defaults to **`true`** — merges nested span styles into
the child during HTML parsing. Relevant whenever paste sanitization is in play.
