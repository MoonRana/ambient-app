export const SUPPORTED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

export const MAX_ATTACHMENTS = 6;

/** ~5 MB decoded (Anthropic's per-image ceiling), expressed in base64 characters. */
export const MAX_ATTACHMENT_BASE64_CHARS = 7_000_000;

/**
 * Identify a base64 payload from its leading bytes. Returns null when the
 * signature is unrecognized so the caller can fall back to a declared type.
 * Exists because iPhone HEIC arrives labelled as JPEG and is rejected upstream.
 */
export function sniffMediaType(base64: string): string | null {
  let head: Uint8Array;
  try {
    const bin = atob(base64.slice(0, 64));
    head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (head.length < 12) return null;

  const ascii = (start: number, len: number) =>
    String.fromCharCode(...head.slice(start, start + len));

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';

  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).toLowerCase();
    if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return 'image/heic';
    if (brand.startsWith('avif') || brand === 'avis') return 'image/avif';
  }

  return null;
}
