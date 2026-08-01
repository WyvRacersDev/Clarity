/**
 * Search service (N3 — global content search).
 *
 * Thin business boundary over the search repository, mirroring how
 * analytics.service wraps analytics.repository: it resolves the caller's
 * identity to an owner id and enforces the query policy (a minimum length, so a
 * single stray character can't scan every row). Keeps the route free of SQL and
 * identity plumbing.
 */
import { resolveUser } from "../repositories/identity.repository.js";
import { searchContent, type SearchHit } from "../repositories/search.repository.js";

/** Ignore queries shorter than this — too noisy to be useful, and cheap to reject. */
export const MIN_SEARCH_QUERY = 2;
/** Hard cap on hits returned to the client. */
export const MAX_SEARCH_RESULTS = 40;

/**
 * Search everything the given user owns. Returns [] for an unknown user or a
 * too-short query rather than throwing, so the caller always has a list.
 */
export async function searchUserContent(
  username: string,
  query: string
): Promise<SearchHit[]> {
  const q = (query ?? "").trim();
  if (q.length < MIN_SEARCH_QUERY) return [];

  const owner = await resolveUser(username);
  if (!owner) return [];

  return searchContent(owner.id, q, MAX_SEARCH_RESULTS);
}
