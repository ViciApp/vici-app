// Flow Mode generative artwork: deterministic hash + PRNG.
//
// FNV-1a hash + mulberry32 keep every render byte-stable across
// reloads for the same seed.

import type { Rng } from '#lib/utils/flow-art/types.ts';
import { fnv1a32 } from '#lib/utils/hash.utils.ts';

const hashStr = fnv1a32;

const mulberry32 = (seed: number): (() => number) => {
	let a = seed >>> 0;

	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const makeRng = (seed: string | number): Rng => {
	const r = mulberry32(typeof seed === 'string' ? hashStr(seed) : seed);

	// `prefer-object-params` is intentionally relaxed for `range` and
	// `int` here: positional `(lo, hi)` is the standard PRNG / math
	// signature and is called thousands of times across the six
	// category renderers. An object form would hurt readability and
	// generate per-call allocations on every random draw.
	return {
		r,
		// eslint-disable-next-line local-rules/prefer-object-params
		range: (lo, hi) => lo + r() * (hi - lo),
		pick: (arr) => arr[Math.floor(r() * arr.length)],
		// eslint-disable-next-line local-rules/prefer-object-params
		int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
		chance: (p) => r() < p
	};
};

export { hashStr, makeRng };
