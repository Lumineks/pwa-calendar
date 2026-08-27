# HTML Sanitization Knowledge Base

Maintained by Compound V Phase 1B advisor. Append at the bottom on each pass.

---

## Updated 2026-08-27 — allowlist sanitizers, mXSS, style-attribute validation

### The core failure class: mutation XSS (mXSS)

mXSS happens when markup parses into one DOM tree during sanitization, then **serializes and re-parses into a different, executable tree** at the sink. The sanitizer inspected a safe tree; the sink built a different one.

The HTML spec itself does not guarantee that serialize-then-reparse round-trips. Every historical DOMPurify bypass lived in that gap: namespace confusion (SVG/MathML), `<mglyph>`, `<noscript>`, `<template>`, `<style>` content re-parsing, attribute values containing `<`/`>`.

Sources: [DOMPurify attack classes & bypass history](https://github.com/cure53/DOMPurify/wiki/Attack-Classes-&-Bypass-History), [Securitum — mXSS via MathML namespace confusion (DOMPurify ≤2.0.17)](https://www.securitum.com/mutation-xss-via-mathml-mutation-dompurify-2-0-17-bypass.html), [mizu.re — exploring DOMPurify bypasses](https://mizu.re/post/exploring-the-dompurify-library-bypasses-and-fixes), [Google Bug Hunters — escaping `<`/`>` in attributes](https://bughunters.google.com/blog/escaping-and-in-attributes-how-it-helps-protect-against-mutation-xss), [Beyond XSS — mutation XSS](https://aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/).

### Rules for any hand-rolled allowlist sanitizer

1. **Sanitize for the exact sink, insert without post-processing.** Parse with `DOMParser`, prune the tree, then insert **nodes** (`replaceChildren(...)`), never a serialized string. `sanitize() → string → innerHTML` (or Svelte `{@html}`, React `dangerouslySetInnerHTML`, Vue `v-html`) is a serialize→reparse cycle by construction.
2. If a string sink is unavoidable: **sanitize twice and compare.** If pass 1 output ≠ pass 2 output, the content mutates on reparse — reject it. Never iterate to a fixpoint silently.
3. **Drop by namespace, not just by tag name.** Anything whose `namespaceURI` is not XHTML goes. `<p>` inside `<svg>` parses differently than `<p>` in HTML.
4. **Explicitly handle the invisible nodes** a naive `querySelectorAll` walk misses: comment nodes, `<template>` content (a separate DocumentFragment), `<noscript>`, `<style>`, CDATA. Walk with `TreeWalker(SHOW_ALL)` or recurse over `childNodes`.
5. **Never regex an attribute value.** Strip the element's entire attribute set and re-add only validated attributes.
6. **Validate CSS via CSSOM round-trip, not string matching.** Assign the candidate to a detached element, read back the normalized value, compare against a normalized allowlist:
   ```js
   const probe = document.createElement('span');
   probe.style.color = '';               // reset
   probe.style.color = candidate;         // browser parses + normalizes
   const normalized = probe.style.color;  // e.g. "rgb(44, 36, 18)"
   if (!ALLOWED_COLORS.has(normalized)) drop();
   // and: probe.style.length must be 1 — reject multi-declaration payloads
   ```
   String-matching `style="color: #abc"` accepts `color:#abc;background-image:url(...)`, CSS escapes, comment-split declarations, and `\3c` sequences.
7. **Bound the tree.** Depth and node count limits — a paste can produce thousands of nested spans, which is a render-stall DoS even with zero XSS.
8. **Sanitize the paste path explicitly.** In ProseMirror/Tiptap that means a `transformPastedHTML` hook; the editor's own schema-based paste handling runs first and is not a sanitizer.

### Build-vs-buy

DOMPurify remains the reference client-side sanitizer (~7 KB gzip): DOM-based, absorbs a decade of bypass reports, handles the edge cases above. A minimal config is small:
```js
DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p','br','span'], ALLOWED_ATTR: ['style'] });
// + addHook('uponSanitizeAttribute', ...) to enforce a colour allowlist via CSSOM
```
Comparison writeups: [sanitize-html vs DOMPurify vs xss, 2026](https://www.pkgpulse.com/guides/sanitize-html-vs-dompurify-vs-xss-xss-prevention-2026).

**Reusable rule:** hand-rolled allowlist parsers are the documented origin of most mXSS. Unless the bundle budget genuinely cannot absorb ~7 KB, buy. If you do hand-roll, the vitest suite must cover the eight rules above, not just "script tags are stripped".

### Threat-model coupling worth naming explicitly

Introducing an HTML sink into an app that stores a bearer token in `localStorage` creates a complete XSS → credential-exfiltration chain that did not exist while content was plain text. The sanitizer changes category from cosmetic to security-critical **in the same release**. Either the sanitizer gets bought-not-built, or the credential moves out of JS reach, or the risk is accepted in writing.

Cheap defence in depth for a static-hosted SPA — a CSP meta tag blocks exfiltration to an arbitrary origin even if the sanitizer fails:
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; connect-src 'self' https://api.example.workers.dev;
               script-src 'self'; object-src 'none'; base-uri 'none'">
```
