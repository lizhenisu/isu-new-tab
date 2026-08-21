import { afterEach, describe, expect, it } from 'vitest';
import { getWallpaperBootstrapPreview, setWallpaperBootstrapPreview } from '../../core/wallpaper/bootstrap-preview';

afterEach(() => localStorage.clear());

describe('wallpaper bootstrap preview', () => {
  it('stores only bounded local backgrounds and approved Unsplash URLs', () => {
    setWallpaperBootstrapPreview({ identity: 'solid:white', background: '#ffffff' });
    expect(getWallpaperBootstrapPreview()).toEqual({ identity: 'solid:white', background: '#ffffff' });

    setWallpaperBootstrapPreview({ identity: 'unsplash:a', background: 'url("https://images.unsplash.com/photo-a")' });
    expect(getWallpaperBootstrapPreview()?.identity).toBe('unsplash:a');

    localStorage.setItem('isu:wallpaper-bootstrap-preview', JSON.stringify({ identity: 'bad', background: 'url("https://example.com/track")' }));
    expect(getWallpaperBootstrapPreview()).toBeUndefined();
  });
});
