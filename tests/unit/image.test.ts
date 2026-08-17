import { describe, expect, it } from 'vitest';
import { hasWebpSignature } from '../../core/wallpaper/image';

describe('WebP validation', () => {
  it('accepts the RIFF/WEBP signature and rejects other files', () => {
    expect(hasWebpSignature(Uint8Array.from([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP')]))).toBe(true);
    expect(hasWebpSignature(new TextEncoder().encode('<script>'))).toBe(false);
  });
});
