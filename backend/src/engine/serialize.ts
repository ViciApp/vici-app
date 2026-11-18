// Candid values are not JSON-clean: bigints, Principals and byte arrays all
// break JSON.stringify. This converts an engine response into a plain JSON
// tree (bigint -> string, Principal -> text, bytes -> hex) for the API layer.

import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';

export const toJson = (value: unknown): unknown => {
	if (typeof value === 'bigint') {
		return value.toString();
	}

	if (value instanceof Principal) {
		return value.toText();
	}

	if (value instanceof Uint8Array) {
		return Buffer.from(value).toString('hex');
	}

	if (Array.isArray(value)) {
		return value.map(toJson);
	}

	if (nonNullish(value) && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toJson(entry)])
		);
	}

	return value;
};
