/**
 * B2: presence + cursor color palette (hash username -> accent spectrum).
 *
 * Deterministically maps a username to one of the album accent colors so the
 * same user always renders in the same color across presence avatars, remote
 * cursors, and comment authors.
 */
export const ACCENT_SPECTRUM = [
  'var(--accent)',
  'var(--accent-blue)',
  'var(--accent-teal)',
  'var(--accent-green)',
  'var(--accent-lime)'
];

/** Deterministically map a username to one of the album accent colors. */
export function userColor(username: string): string {
  if (!username) return ACCENT_SPECTRUM[0];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) & 0x7fffffff;
  }
  return ACCENT_SPECTRUM[hash % ACCENT_SPECTRUM.length];
}
