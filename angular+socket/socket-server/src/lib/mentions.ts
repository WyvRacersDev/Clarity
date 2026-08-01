// ============================================================================
// @mentions (N7)
//
// Pure, dependency-free parsing of `@username` tokens out of free text. Kept
// separate from the gateway so it is trivially unit-testable and reusable, and
// so the transport layer only decides *where* to deliver, not *how* to parse.
// ============================================================================

// A mention token: '@' followed by username-safe characters. We allow letters,
// digits, and the separators that usernames/emails commonly use. The '@' must
// not be preceded by a word character so we don't match email addresses.
const MENTION_RE = /(^|[^\w@])@([a-zA-Z0-9._-]+)/g;

/**
 * Extract the unique set of mentioned usernames from a body of text.
 * Returns them in first-seen order, without the leading '@'.
 */
export function parseMentions(body: string): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(MENTION_RE)) {
    const name = match[2];
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
