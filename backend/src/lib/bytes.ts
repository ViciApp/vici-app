// Byte-array helpers shared by auth (WebAuthn and IC delegation checks) and
// the chain transaction builders. Kept free of env and I/O so signing code can
// import it without loading config.

/** A fresh `Uint8Array` holding every part in order; the inputs are copied,
 * never aliased. */
export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let offset = 0;

	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
};
