import { describe, expect, test } from 'bun:test';
import { readRepoFile } from '../helpers/repo-source';

// The engine candid declarations under backend/src/declarations are vendored
// copies of the generated originals under src/declarations. Regenerating one
// side (npm run did) without re-vendoring desyncs the wire contract, so every
// mirrored file is pinned byte-for-byte. Backend-only files (the index.ts
// wiring and the satellite bindings the ETL drain reads, which have no
// original left in the app) are deliberately not listed.
const MIRRORED_DECLARATIONS = [
	'clearing/clearing.certified.idl.d.ts',
	'clearing/clearing.certified.idl.js',
	'clearing/clearing.d.ts',
	'clearing/clearing.did',
	'clearing/clearing.idl.d.ts',
	'clearing/clearing.idl.js',
	'registry/registry.certified.idl.d.ts',
	'registry/registry.certified.idl.js',
	'registry/registry.d.ts',
	'registry/registry.did',
	'registry/registry.idl.d.ts',
	'registry/registry.idl.js'
] as const;

describe('shared drift: vendored candid declarations', () => {
	for (const file of MIRRORED_DECLARATIONS) {
		test(`backend copy of ${file} is byte-identical to src/declarations`, () => {
			const vendored = readRepoFile(`backend/src/declarations/${file}`);
			const original = readRepoFile(`src/declarations/${file}`);

			expect(vendored.equals(original)).toBe(true);
		});
	}
});
