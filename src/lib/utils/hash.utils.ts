// Shared string-hash helpers. These are NOT cryptographic primitives;
// they exist to derive deterministic seeds and digests (artwork PRNGs,
// avatar URLs, invite-code suffixes, referral codes, school code digests)
// from arbitrary input without taking a dependency on `crypto.subtle`
// (the satellite runtime has none) and without sending the raw input to a
// third party. The satellite imports this module, so it stays free of DOM
// APIs and regex literals.

/**
 * 32-bit FNV-1a hash. Fast, branch-free, allocation-free; the workhorse
 * seed for FlowArt's `mulberry32` PRNG and any time we need a stable
 * unsigned int from a string.
 */
export const fnv1a32 = (input: string): number => {
	let h = 0x811c9dc5;

	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
	}

	return h >>> 0;
};

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

const toHex64 = (hash: bigint): string => hash.toString(16).padStart(16, '0');

/**
 * 64-bit FNV-1a over the UTF-8 bytes of the input. Referral codes and
 * school code digests are derived from it and stored, so its output must
 * never change.
 */
export const fnv1a64 = (input: string): bigint => {
	const bytes = new TextEncoder().encode(input);
	let hash = FNV64_OFFSET;

	for (const b of bytes) {
		hash = (hash ^ BigInt(b)) & MASK64;
		hash = (hash * FNV64_PRIME) & MASK64;
	}

	return hash;
};

/** {@link fnv1a64} as a zero-padded 16-char hex string. */
export const fnv1a64Hex = (input: string): string => toHex64(fnv1a64(input));

/**
 * 64-bit FNV-1a over the UTF-16 code units of the input (not UTF-8
 * bytes, so it differs from {@link fnv1a64Hex} for non-ASCII input),
 * returned as a zero-padded 16-char hex string. Derives the opaque
 * DiceBear seed from the user's principal so the raw principal never
 * leaves the client in avatar requests.
 */
export const fnv1a64Utf16Hex = (input: string): string => {
	let hash = FNV64_OFFSET;

	for (let i = 0; i < input.length; i++) {
		hash ^= BigInt(input.charCodeAt(i));
		hash = (hash * FNV64_PRIME) & MASK64;
	}

	return toHex64(hash);
};
