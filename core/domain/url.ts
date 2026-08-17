const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function normalizeShortcutUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('URL_REQUIRED');
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('URL_INVALID');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error('URL_PROTOCOL_NOT_ALLOWED');
  if (!url.hostname) throw new Error('URL_INVALID');
  return url.toString();
}

export function faviconUrl(pageUrl: string, size = 64): string {
  const params = new URLSearchParams({ pageUrl, size: String(size) });
  return `/_favicon/?${params.toString()}`;
}
