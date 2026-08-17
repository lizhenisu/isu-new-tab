import type { Wallpaper } from './types';

export type WallpaperTone = 'light' | 'dark';

export function wallpaperTone(wallpaper: Wallpaper): WallpaperTone {
  if (wallpaper.type !== 'solid') return 'dark';

  const [red, green, blue] = parseHexColor(wallpaper.color);
  const luminance = .2126 * linearize(red) + .7152 * linearize(green) + .0722 * linearize(blue);
  return luminance >= .45 ? 'light' : 'dark';
}

function parseHexColor(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
  ];
}

function linearize(channel: number): number {
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}
