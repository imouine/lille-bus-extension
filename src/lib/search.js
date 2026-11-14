import { noAccents } from "./transit.js";

/** Normalize stop labels and user input to comparable, punctuation-free words. */
export function normalizeStopSearch(value) {
  return noAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Return a relevance rank for a stop label, or null when it does not match.
 * Every query word may match the beginning of any word in the stop label.
 */
export function stopSearchRank(searchText, query) {
  const candidate = normalizeStopSearch(searchText);
  const normalizedQuery = normalizeStopSearch(query);
  if (normalizedQuery.length < 2) return null;
  if (candidate === normalizedQuery) return 0;
  if (candidate.startsWith(normalizedQuery)) return 1;

  const candidateWords = candidate.split(" ").filter(Boolean);
  const queryWords = [...new Set(normalizedQuery.split(" ").filter(Boolean))];
  if (queryWords.every((word) => candidateWords.includes(word))) return 2;
  if (queryWords.every((word) => candidateWords.some((candidateWord) => candidateWord.startsWith(word)))) return 3;

  // Preserve the previous contains behavior for a single partial word.
  if (queryWords.length === 1 && candidate.includes(normalizedQuery)) return 4;
  return null;
}
