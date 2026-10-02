/**
 * Ranking for the command palette (plan15 Wave 9). Small, pure and dependency-free: the palette
 * filters a few dozen static commands on the client, and a library for that would cost more than
 * the whole feature.
 *
 * A command matches when every whitespace-separated token of the query is found, in any order, in
 * its title, keywords or group label. It ranks higher the earlier and more exactly the tokens match:
 *   - a title that starts with the token beats a title word that starts with it, which beats a match
 *     in the middle of a word, which beats a keyword match, which beats a group-label match;
 *   - an exact title beats a prefix;
 *   - ties keep the authored order (a stable sort), so the palette's default ordering is meaningful.
 * An empty query matches everything with score 0, so the unfiltered list is the authored list.
 */
export interface Scorable {
  title: string;
  keywords?: readonly string[];
  group?: string;
}

const normalise = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s&+/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tokenScore(token: string, title: string, keywords: readonly string[], group: string): number {
  if (title === token) return 100;
  if (title.startsWith(token)) return 80;
  if (title.split(" ").some((word) => word.startsWith(token))) return 60;
  if (title.includes(token)) return 40;
  if (keywords.some((keyword) => keyword.startsWith(token))) return 30;
  if (keywords.some((keyword) => keyword.includes(token))) return 20;
  if (group.includes(token)) return 10;
  return -1;
}

/** The score of `item` for `query`, or -1 when it does not match. */
export function scoreCommand(query: string, item: Scorable): number {
  const tokens = normalise(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return 0;
  const title = normalise(item.title);
  const keywords = (item.keywords ?? []).map(normalise);
  const group = normalise(item.group ?? "");
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(token, title, keywords, group);
    if (score < 0) return -1;
    total += score;
  }
  return total;
}

/** Filter and rank, keeping authored order for ties. */
export function rankCommands<T extends Scorable>(query: string, items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreCommand(query, item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
