/**
 * Sequential fuzzy matcher tailored to file-path autocomplete.
 *
 * Scoring favors what developers actually look for when they type a
 * partial filename:
 * - Matches inside the BASENAME (after the last `/`) count more than
 *   matches in intermediate directory segments. Typing `btn` should
 *   prefer `components/Button.tsx` over `src/button-test/` even though
 *   the latter has `btn` in a directory name.
 * - CONSECUTIVE matches chain nicely — `btn` matching `Button` in
 *   positions 0-1-3 beats matching at 0-3-4.
 * - WORD-BOUNDARY starts (right after `/`, `-`, `_`, `.`, or a camelCase
 *   break) get a bonus — matching at start of words is how humans
 *   remember names.
 *
 * Not a Levenshtein-distance matcher (typos). Not TF-IDF. Just a
 * pragmatic scorer that feels right for "I'm halfway through the
 * filename I want". If it proves insufficient we can swap in a
 * fzf-for-js or sublime-fuzzy library later — the signature is kept
 * library-agnostic.
 */

export interface FuzzyMatch {
  /** Higher is better. Scores cross-queries aren't comparable. */
  score: number;
  /** Positions in `haystack` where each query character matched. */
  indices: number[];
}

const BASENAME_BONUS = 3; // multiplier for matches inside the basename
const CONSECUTIVE_BONUS = 15;
const WORD_BOUNDARY_BONUS = 10;
const EXACT_PREFIX_BONUS = 25;
const FIRST_CHAR_BONUS = 8;

function isBoundary(prev: string, cur: string): boolean {
  if (prev === "/" || prev === "\\") return true;
  if (prev === "-" || prev === "_" || prev === ".") return true;
  if (prev === " ") return true;
  // camelCase: lower-then-upper
  if (prev.toLowerCase() === prev && prev !== prev.toUpperCase() && cur.toUpperCase() === cur) {
    return true;
  }
  return false;
}

/**
 * Match `query` (short) against `haystack` (full path or name).
 * Returns null when any query char can't be matched in order.
 */
export function fuzzyScore(query: string, haystack: string): FuzzyMatch | null {
  if (query === "") return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();

  // Basename split for bonus weighting.
  const lastSlash = haystack.lastIndexOf("/");
  const basenameStart = lastSlash === -1 ? 0 : lastSlash + 1;

  // Fast exit: exact prefix match in basename gets a huge boost.
  const basenameLower = h.slice(basenameStart);
  if (basenameLower.startsWith(q)) {
    const indices: number[] = [];
    for (let i = 0; i < q.length; i++) indices.push(basenameStart + i);
    return {
      score: EXACT_PREFIX_BONUS * q.length * BASENAME_BONUS + q.length, // dominates fuzzy
      indices,
    };
  }

  let score = 0;
  const indices: number[] = [];
  let hi = 0;
  let prevMatched = -2;

  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi];
    while (hi < h.length && h[hi] !== qc) hi++;
    if (hi >= h.length) return null;
    indices.push(hi);

    const inBasename = hi >= basenameStart;
    const segMul = inBasename ? BASENAME_BONUS : 1;

    // Per-char base score.
    let charScore = 1 * segMul;

    // First query char bonus.
    if (qi === 0) charScore += FIRST_CHAR_BONUS * segMul;

    // Consecutive run bonus.
    if (hi === prevMatched + 1) charScore += CONSECUTIVE_BONUS * segMul;

    // Word-boundary bonus (match at a "start of word" in the haystack).
    const prev = hi > 0 ? haystack[hi - 1] : "/";
    const cur = haystack[hi];
    if (hi === 0 || isBoundary(prev, cur)) {
      charScore += WORD_BOUNDARY_BONUS * segMul;
    }

    score += charScore;
    prevMatched = hi;
    hi++;
  }

  return { score, indices };
}

export interface ScoredEntry<T> {
  entry: T;
  score: number;
  indices: number[];
}

/**
 * Score and sort a list. Returns the top `limit` matches in descending
 * score order. Ties break alphabetically on the haystack.
 */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  haystackOf: (item: T) => string,
  limit: number = 20,
): ScoredEntry<T>[] {
  if (items.length === 0) return [];
  const out: ScoredEntry<T>[] = [];
  for (const item of items) {
    const hs = haystackOf(item);
    const m = fuzzyScore(query, hs);
    if (!m) continue;
    out.push({ entry: item, score: m.score, indices: m.indices });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return haystackOf(a.entry).localeCompare(haystackOf(b.entry));
  });
  return out.slice(0, limit);
}
