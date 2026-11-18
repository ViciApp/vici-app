/**
 * Matches the agent-level rejections produced while the satellite is stopped
 * for a deploy (`juno functions upgrade` stops the canister while the wasm is
 * swapped): IC0508 "Canister … is stopped", IC0509 "… is stopping", the
 * replica's `canister_not_running` reject, and the HTTP gateway's 503 while
 * it cannot reach the canister. Deliberately narrow: a generic network
 * failure must NOT flip the app into maintenance mode; the caller confirms
 * with a reachability probe anyway (see `maintenance.services.ts`).
 */
const STOPPED_PATTERN = /is stopped|is stopping|canister_not_running|IC0508|IC0509|503/i;

const errorText = (err: unknown): string => {
	if (err instanceof Error) {
		const cause = 'cause' in err && err.cause instanceof Error ? ` ${err.cause.message}` : '';

		return `${err.message}${cause}`;
	}

	return typeof err === 'string' ? err : '';
};

export const isCanisterStoppedError = (err: unknown): boolean =>
	STOPPED_PATTERN.test(errorText(err));
