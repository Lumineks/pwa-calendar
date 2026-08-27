/**
 * HTML sanitizer for entry bodies. Security-critical: v2 renders
 * user-authored HTML next to a bearer token in localStorage.
 *
 * Strategy: DOMPurify with a tight allowlist (p, br, span), span attributes
 * rebuilt from scratch, colors validated via CSSOM round-trip against the
 * palette, nesting depth bounded, and a sanitize-twice stability check
 * (mXSS guard for the string→{@html} sink).
 */
import DOMPurify from 'dompurify';
import { PALETTE } from './palette.ts';

const MAX_DEPTH = 20;

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

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName !== 'SPAN') {
      node.removeAttribute('style');
      return;
    }
    // Rebuild span attrs from scratch: only a validated color survives.
    const el = node as HTMLElement;
    const candidate = el.style.color; // CSSOM-parsed, ignores junk declarations
    while (el.attributes.length > 0) el.removeAttribute(el.attributes[0]!.name);
    const n = candidate ? normalizeColor(candidate) : null;
    if (n && allowed().has(n)) {
      el.setAttribute('style', `color: ${n}`);
    }
  });

  DOMPurify.addHook('afterSanitizeElements', (node) => {
    if (!(node instanceof Element)) return;
    let depth = 0;
    let p: Node | null = node;
    while (p) {
      depth++;
      p = p.parentNode;
    }
    if (depth > MAX_DEPTH && node.parentNode) {
      // Flatten: replace the element with its children (keeps text).
      while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
      node.parentNode.removeChild(node);
    }
  });
}

function purifyOnce(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'span'],
    ALLOWED_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
  });
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function sanitizeHtml(html: string): string {
  const once = purifyOnce(html);
  const twice = purifyOnce(once);
  if (twice !== once) {
    // Unstable under re-parse → potential mXSS. Degrade to escaped text.
    const div = document.createElement('div');
    div.innerHTML = once;
    return `<p>${escapeHtml(div.textContent ?? '')}</p>`;
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
  const div = document.createElement('div');
  div.innerHTML = purifyOnce(html);
  return (div.textContent ?? '').trim() === '';
}

export function toEditorHtml(
  entry: { body: string; format?: 'html' } | undefined,
): string {
  if (!entry || entry.body === '') return '';
  if (entry.format === 'html') return sanitizeHtml(entry.body);
  return plainToHtml(entry.body); // legacy plain text — format marker absent
}
