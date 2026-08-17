import { describe, expect, it } from 'vitest';
import { faviconUrl, normalizeShortcutUrl } from '../../core/domain/url';

describe('shortcut URL safety', () => {
  it('normalizes a hostname to HTTPS', () => {
    expect(normalizeShortcutUrl(' example.com/path ')).toBe('https://example.com/path');
  });

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/x', 'chrome://settings', 'chrome-extension://abc/page'])('rejects %s', (value) => {
    expect(() => normalizeShortcutUrl(value)).toThrow('URL_PROTOCOL_NOT_ALLOWED');
  });

  it('builds the native favicon URL without a third-party service', () => {
    expect(faviconUrl('https://example.com')).toContain('/_favicon/');
    expect(faviconUrl('https://example.com')).toContain('pageUrl=https%3A%2F%2Fexample.com');
  });
});
