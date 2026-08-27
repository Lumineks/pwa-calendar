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
  it('bounds pathological nesting', () => {
    const deep = '<span>'.repeat(200) + 'x' + '</span>'.repeat(200);
    const out = sanitizeHtml(`<p>${deep}</p>`);
    expect(out).toContain('x');
    expect((out.match(/<span/g) ?? []).length).toBeLessThan(50);
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
