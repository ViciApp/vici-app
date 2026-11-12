/**
 * Exact median of a numeric array. Returns 0 for an empty array (an
 * empty-consensus user can't clear the bold-caller gate anyway since they
 * have no calls).
 */
export const median = (values: readonly number[]): number => {
	if (values.length === 0) {
		return 0;
	}

	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};
