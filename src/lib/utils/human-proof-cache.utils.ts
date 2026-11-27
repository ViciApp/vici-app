import { nonNullish } from '@dfinity/utils';

export interface IssuedHumanProof {
	proof: string;
	/** Lifetime from issue, as the server counts it. */
	ttlMs: number;
}

export interface HumanProofCache {
	/** A proof still inside its lifetime, issuing one when none is held.
	 * Concurrent callers share one issue, so a burst of probes costs one bot
	 * check. */
	get: () => Promise<string>;
	/** Forget the held proof, for when the server refused it. */
	invalidate: () => void;
}

/**
 * Holds the proof an anonymous surface presents on every call. The lifetime
 * is counted on the local clock from the moment the proof arrived, so a
 * skewed clock cannot keep a dead proof alive; `marginMs` renews it shortly
 * before the server would refuse it.
 */
export const createHumanProofCache = ({
	issue,
	marginMs,
	nowMs = Date.now
}: {
	issue: () => Promise<IssuedHumanProof>;
	marginMs: number;
	nowMs?: () => number;
}): HumanProofCache => {
	let held: { proof: string; renewAtMs: number } | undefined;
	let issuing: Promise<string> | undefined;

	const get = async (): Promise<string> => {
		if (nonNullish(held) && nowMs() < held.renewAtMs) {
			return held.proof;
		}

		issuing ??= (async () => {
			try {
				const { proof, ttlMs } = await issue();

				held = { proof, renewAtMs: nowMs() + ttlMs - marginMs };

				return proof;
			} finally {
				issuing = undefined;
			}
		})();

		return await issuing;
	};

	const invalidate = (): void => {
		held = undefined;
	};

	return { get, invalidate };
};
