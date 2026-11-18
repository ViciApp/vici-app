/**
 * Normalizes a World-Cup market question into the key the per-market
 * artwork table (`WC_MARKET_ART`) is indexed by: trimmed, internal
 * whitespace collapsed to single spaces, lower-cased. Accents and
 * apostrophes are intentionally preserved: they are part of the team names
 * that distinguish questions. Both the table (author time) and incoming
 * market titles (lookup time) pass through this so a match never hinges on
 * incidental spacing or casing differences.
 */
export const normalizeWcQuestion = (question: string): string =>
	question.trim().replace(/\s+/g, ' ').toLowerCase();
