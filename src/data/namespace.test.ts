import { describe, it, expect } from 'vitest';
import { namespaceFor, nsKey, dbNameFor } from './namespace';

describe('namespaceFor', () => {
  it('is deterministic and 8 hex chars', () => {
    const a = namespaceFor('some-token-value');
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(namespaceFor('some-token-value')).toBe(a);
  });
  it('distinguishes different tokens', () => {
    expect(namespaceFor('token-a')).not.toBe(namespaceFor('token-b'));
  });
});

describe('key builders', () => {
  it('builds localStorage keys and db name', () => {
    expect(nsKey('deadbeef', 'dirty')).toBe('journal:deadbeef:dirty');
    expect(dbNameFor('deadbeef')).toBe('journal-deadbeef');
  });
});
