/**
 * HTML sanitizer for entry bodies. Security-critical: v2 renders
 * user-authored HTML next to a bearer token in localStorage.
 *
 * Strategy: DOMPurify (private instance) with a tight allowlist
 * (p, br, span, strong), span attributes rebuilt from scratch (strong is
 * always left attributeless — the non-SPAN branch of the attribute hook
 * strips everything, `style` included), colors validated via CSSOM
 * round-trip against the palette, nesting depth bounded by a post-walk pass
 * over DOMPurify's own (already-clean) output fragment, and a sanitize-twice
 * stability check (mXSS guard for the string→{@html} sink). Fails closed
 * (never identity-passes dirty markup) when no functional DOM is available.
 */
import DOMPurify, { type DOMPurify as DOMPurifyInstance, type Config } from 'dompurify';
import { PALETTE } from './palette.ts';

const MAX_DEPTH = 20;

const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: ['p', 'br', 'span', 'strong'],
  ALLOWED_ATTR: ['style'],
  ALLOW_DATA_ATTR: false,
};

// F4: a private purifier instance, not the shared module-level singleton, so
// our hooks/config travel with this module and never leak onto (or get
// clobbered by) any other consumer of the `dompurify` package.
const purifier: DOMPurifyInstance =
  typeof window !== 'undefined' ? DOMPurify(window) : DOMPurify;

let allowedColors: Set<string> | null = null;

function normalizeColor(css: string): string | null {
  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = css;
  return probe.style.color !== '' ? probe.style.color : null;
}

function allowed(): Set<string> {
  if (allowedColors) return allowedColors;
  allowedColors = new Set<string>();
  for (const pen of PALETTE) {
    const n = normalizeColor(pen.css);
    if (n) allowedColors.add(n);
  }
  return allowedColors;
}

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName !== 'SPAN') {
      node.removeAttribute('style');
      return;
    }
    // Rebuild span attrs from scratch: only a validated color survives.
    const el = node as HTMLElement;
    const candidate = el.style.color; // CSSOM-parsed, ignores junk declarations
    // Snapshot first: removeAttribute-by-name can spin forever on some
    // uppercase/namespaced qualified names, so walk a static array instead
    // of the live, self-shrinking NamedNodeMap.
    for (const attr of [...el.attributes]) el.removeAttributeNode(attr);
    const n = candidate ? normalizeColor(candidate) : null;
    if (n && allowed().has(n)) {
      el.setAttribute('style', `color: ${n}`);
    }
  });

  // NOTE (F1): there used to be an `afterSanitizeElements` hook here that
  // flattened over-deep nodes *while DOMPurify was still walking its own
  // live NodeIterator*. Per the DOM's "pre-removing steps", hoisting a
  // node's children and removing the node makes the iterator resume AFTER
  // the hoisted subtree — so DOMPurify silently skipped sanitizing
  // everything below the flatten point (script/img-with-onerror could
  // survive). Depth bounding now happens strictly AFTER DOMPurify has
  // finished its own traversal, in flattenExcessDepth() below, over an
  // already-fully-sanitized, detached DocumentFragment.
}

/** Post-walk depth bound: operates on a fragment DOMPurify has already
 * fully sanitized (RETURN_DOM_FRAGMENT), so it can only rearrange the
 * allowed p/br/span structure — it never needs to (and never does) decide
 * what is "safe" content. */
function flattenExcessDepth(root: DocumentFragment): void {
  const walk = (node: Node, depth: number): void => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (depth > MAX_DEPTH) {
      const parent = node.parentNode;
      if (!parent) return;
      const promoted = Array.from(node.childNodes);
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      // The node's children now occupy the depth the node itself was at
      // (its removal shifts them up exactly one level) — re-check them at
      // that same depth rather than depth+1.
      for (const child of promoted) walk(child, depth);
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child, depth + 1);
    }
  };
  for (const child of Array.from(root.childNodes)) {
    walk(child, 1);
  }
}

/** Move a fragment's nodes into a detached (unconnected, non-rendered)
 * container purely to read back `.innerHTML`. Safe here because the
 * fragment has already been through DOMPurify's allowlist (p/br/span only,
 * no event-handler-capable attributes) — this only serializes, it never
 * parses attacker-controlled markup into a live sink. */
function serializeFragment(fragment: DocumentFragment): string {
  const container = document.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

/** Extract text via an inert DOMParser document, which has no browsing
 * context: nothing loads, nothing executes, no matter what the input
 * contains. Used for anything that touches *pre-sanitization or
 * not-yet-re-verified* markup. */
function textOf(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    try {
      return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    } catch {
      // fall through to the opaque-string fallback below
    }
  }
  return html;
}

// Precondition: only call when purifier.isSupported (checked by callers).
function purifyOnce(html: string): string {
  installHooks();
  const fragment = purifier.sanitize(html, {
    ...SANITIZE_CONFIG,
    RETURN_DOM_FRAGMENT: true,
  });
  flattenExcessDepth(fragment);
  const serialized = serializeFragment(fragment);
  // Restore the string contract with one more plain pass — also re-verifies
  // the allowlist/attrs after the depth-flattening restructure above.
  return purifier.sanitize(serialized, SANITIZE_CONFIG);
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapedFallback(html: string): string {
  return `<p>${escapeHtml(textOf(html))}</p>`;
}

export function sanitizeHtml(html: string): string {
  if (!purifier.isSupported) {
    // F3: fail closed. Without a functional purifier we must never return
    // (or even lightly touch) the dirty string verbatim.
    return escapedFallback(html);
  }
  const once = purifyOnce(html);
  const twice = purifyOnce(once);
  if (twice !== once) {
    // Unstable under re-parse → potential mXSS. Degrade to escaped text via
    // an inert DOMParser document (never assign purifier output to a live
    // element's innerHTML).
    return escapedFallback(once);
  }
  return once;
}

export function plainToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

export function isEmptyHtml(html: string): boolean {
  if (html.trim() === '') return true;
  if (!purifier.isSupported) {
    // F3: conservative fail-closed — without a functional purifier we can't
    // safely inspect the markup, so only whitespace-only strings are empty.
    return false;
  }
  return textOf(purifyOnce(html)).trim() === '';
}

export function toEditorHtml(
  entry: { body: string; format?: 'html' } | undefined,
): string {
  if (!entry || entry.body === '') return '';
  if (entry.format === 'html') return sanitizeHtml(entry.body);
  return plainToHtml(entry.body); // legacy plain text — format marker absent
}
