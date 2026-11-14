/**
 * The UTC `YYYY-MM` anchor of the month containing `ms`: the key of every
 * monthly doc (affiliation stats, user monthly stats, tournaments). UTC so
 * the satellite, which runs on IC time, and every browser agree on the
 * month around a rollover.
 */
export const monthAnchorFromMs = (ms: number): string => {
	const d = new Date(ms);
	const year = d.getUTCFullYear();
	const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');

	return `${year}-${month}`;
};

/**
 * The anchor of the UTC month before the one containing `nowMs`: the last
 * completed month, whose podium is claimable.
 */
export const previousMonthAnchor = (nowMs: number = Date.now()): string => {
	const d = new Date(nowMs);
	d.setUTCDate(1);
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCMonth(d.getUTCMonth() - 1);

	return monthAnchorFromMs(d.getTime());
};
