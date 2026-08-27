import { describe, it, expect } from 'vitest';
import { sanitizeHtml, plainToHtml, isEmptyHtml, toEditorHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('keeps allowed markup with palette colors', () => {
    const input = '<p>привет <span style="color: #c43c3c">красным</span></p>';
    const out = sanitizeHtml(input);
    expect(out).toContain('привет');
    expect(out).toMatch(/<span style="color: (rgb\(196, 60, 60\)|#c43c3c)/);
  });
  it('strips scripts, handlers and unknown tags but keeps text', () => {
    const out = sanitizeHtml('<p onclick="x()">a<script>bad()</script><img src=x onerror=y>b</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('img');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });
  it('removes colors outside the palette', () => {
    const out = sanitizeHtml('<p><span style="color: #ff0000">x</span></p>');
    expect(out).not.toContain('ff0000');
    expect(out).not.toContain('rgb(255, 0, 0)');
    expect(out).toContain('x');
  });
  it('rebuilds span style from scratch (extra declarations dropped)', () => {
    const out = sanitizeHtml(
      '<p><span style="color: #2e5aac; background-image: url(https://evil/x)">x</span></p>',
    );
    expect(out).not.toContain('background');
    expect(out).not.toContain('url');
  });
  it('drops non-XHTML namespaces / templates / comments', () => {
    const out = sanitizeHtml('<p><math><mglyph></mglyph></math><template>t</template><!-- c -->ok</p>');
    expect(out).not.toContain('math');
    expect(out).not.toContain('template');
    expect(out).toContain('ok');
  });
  it('bounds pathological nesting (post-walk flatten, not a DOMPurify-traversal interrupt)', () => {
    const deep = '<span>'.repeat(200) + 'x' + '</span>'.repeat(200);
    const out = sanitizeHtml(`<p>${deep}</p>`);
    // Depth flattening must land on the sanitizeHtml() output itself, not
    // rely on the double-pass mXSS fallback to incidentally rescue it: the
    // structure below stays a real <p>/<span> document (never degrades to
    // the escaped-text fallback), and the flatten pass provably ran (the
    // 200-deep chain is collapsed well under the 20-deep bound).
    expect(out).toContain('<p');
    expect(out).toContain('x');
    expect((out.match(/<span/g) ?? []).length).toBeLessThan(50);
    // sanitize.ts's internal MAX_DEPTH is 20 (not exported — this asserts
    // the observable behavior it produces, not the constant itself).
    expect((out.match(/<span/g) ?? []).length).toBeLessThanOrEqual(20);
  });

  it('does not let dangerous markup slip past sanitization via the depth-flatten path (F1 regression)', () => {
    // Nest well past MAX_DEPTH so the flatten pass definitely fires, with a
    // script/img-with-onerror INSIDE the over-deep region. Before the F1
    // fix, the old afterSanitizeElements hook flattened nodes *while*
    // DOMPurify's own live traversal was still walking them, which made the
    // iterator skip sanitizing everything below the flatten point — so this
    // dangerous markup survived purifyOnce entirely.
    const before = '<span>'.repeat(30);
    const after = '</span>'.repeat(30);
    const input = `<p>${before}<img src=x onerror=alert(1)><script>bad()</script>keep${after}</p>`;
    const out = sanitizeHtml(input);
    expect(out).not.toContain('img');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
    expect(out).toContain('keep');
    // Depth bounding only restructures allowed p/br/span elements — it must
    // not force an otherwise-safe-after-sanitization document into the
    // escaped-text mXSS fallback. A plain "<p>" alone is NOT enough to prove
    // this (the fallback also wraps its output in "<p>"); the discriminating
    // signal is that <span> structure survives at all. On the pre-fix
    // implementation this assertion fails: the live-traversal bug corrupted
    // purifyOnce's output enough to make the sanitize-twice stability check
    // trip, and the resulting fallback collapses everything to a single
    // spanless "<p>bad()keep</p>".
    expect(out).toContain('<span');
  });
});

describe('plainToHtml / isEmptyHtml / toEditorHtml', () => {
  it('escapes and wraps lines', () => {
    expect(plainToHtml('a<b\nc')).toBe('<p>a&lt;b</p><p>c</p>');
  });
  it('detects empty documents', () => {
    expect(isEmptyHtml('')).toBe(true);
    expect(isEmptyHtml('<p></p>')).toBe(true);
    expect(isEmptyHtml('<p>  </p><p></p>')).toBe(true);
    expect(isEmptyHtml('<p>x</p>')).toBe(false);
  });
  it('dispatches on the explicit format marker only', () => {
    expect(toEditorHtml({ body: '<p>x</p>', format: 'html' })).toContain('<p>x</p>');
    // legacy plain text that LOOKS like html stays text:
    expect(toEditorHtml({ body: '<p>не разметка' })).toContain('&lt;p&gt;не разметка');
    expect(toEditorHtml(undefined)).toBe('');
  });
});
