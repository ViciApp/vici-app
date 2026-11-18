// Every canister method answers a candid `Result`; the typed wrappers in
// `clearing.ts` and `registry.ts` unwrap it here so an `Err` always throws
// with the method name and the engine's own error.

import { jsonReplacer } from '@dfinity/utils';

export const expectOk = <O>(result: { Ok: O } | { Err: unknown }, label: string): O => {
	if ('Ok' in result) {
		return result.Ok;
	}

	throw new Error(`${label} failed: ${JSON.stringify(result.Err, jsonReplacer)}`);
};
