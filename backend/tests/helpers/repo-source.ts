// Readers over the repository sources for the shared-drift suite, which pins
// constants deliberately mirrored between the app code under src/ and this
// backend so the two stacks cannot diverge silently.
//
// Most mirrored app modules cannot be imported from here: a value import of an
// app dependency (schema builders, IC SDKs, Vite env access) would need the
// repo root node_modules, which the backend CI job does not install, and every
// imported file would be compiled under this package's stricter compiler
// options. Pure modules (no value imports) are loaded via importRepoModule, a
// runtime dynamic import the typechecker does not follow; everything else is
// pinned by reading the source text and extracting the declared literals.

import { isNullish } from '@dfinity/utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

export const readRepoFile = (relPath: string): Buffer => readFileSync(join(REPO_ROOT, relPath));

/** TS/JS source with comments stripped, so extractors never match quoted
 * words inside doc comments. A `//` is only treated as a comment when it
 * starts a line or follows whitespace, which leaves `://` in URLs intact. */
export const readRepoSource = (relPath: string): string =>
	readRepoFile(relPath)
		.toString('utf8')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');

export const importRepoModule = async <T>(relPath: string): Promise<T> =>
	(await import(join(REPO_ROOT, relPath))) as T;

/** The balanced `open`...`close` span (inner content) that starts at the first
 * `open` after `marker`. Throws when the marker or the block is missing, so a
 * refactor of the mirrored source fails the suite loudly instead of silently
 * comparing empty sets. */
export const extractBlock = ({
	source,
	marker,
	open = '[',
	close = ']'
}: {
	source: string;
	marker: string;
	open?: string;
	close?: string;
}): string => {
	const markerIdx = source.indexOf(marker);

	if (markerIdx < 0) {
		throw new Error(`marker not found in source: ${marker}`);
	}

	const start = source.indexOf(open, markerIdx + marker.length);

	if (start < 0) {
		throw new Error(`no ${open} block after marker: ${marker}`);
	}

	let depth = 0;

	for (let i = start; i < source.length; i += 1) {
		if (source[i] === open) {
			depth += 1;
		} else if (source[i] === close) {
			depth -= 1;

			if (depth === 0) {
				return source.slice(start + 1, i);
			}
		}
	}

	throw new Error(`unbalanced ${open}${close} block after marker: ${marker}`);
};

/** All single-quoted string literals in a snippet, in order. */
export const quotedStrings = (snippet: string): string[] =>
	[...snippet.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');

/** Members of `export type <name> = | 'a' | 'b' ...;` in declaration order. */
export const extractUnionLiterals = ({
	source,
	typeName
}: {
	source: string;
	typeName: string;
}): string[] => {
	const marker = `export type ${typeName} =`;
	const start = source.indexOf(marker);

	if (start < 0) {
		throw new Error(`type not found in source: ${typeName}`);
	}

	const end = source.indexOf(';', start);

	if (end < 0) {
		throw new Error(`unterminated type declaration: ${typeName}`);
	}

	return quotedStrings(source.slice(start, end));
};

/** `{ key: number, ... }` pairs from the object literal following `marker`;
 * keys may be identifiers or numbers (`gold: 400`, `3: 50`). */
export const extractNumericRecord = ({
	source,
	marker
}: {
	source: string;
	marker: string;
}): Record<string, number> => {
	const block = extractBlock({ source, marker, open: '{', close: '}' });
	const record: Record<string, number> = {};

	for (const match of block.matchAll(/([A-Za-z_$][\w$]*|\d+)\s*:\s*(\d+)/g)) {
		record[match[1] ?? ''] = Number(match[2]);
	}

	return record;
};

/** The whole-VXP figure of `<constName> = vxpBaseUnits(N)`. */
export const extractVxpBaseUnitsWhole = ({
	source,
	constName
}: {
	source: string;
	constName: string;
}): number => {
	const block = extractBlock({
		source,
		marker: `${constName} = vxpBaseUnits`,
		open: '(',
		close: ')'
	});
	const match = block.match(/^\s*(\d+)\s*$/);

	if (!match) {
		throw new Error(`no whole-VXP literal for: ${constName}`);
	}

	return Number(match[1]);
};

/** The integer literal of `<constName> = N`. */
export const extractIntConst = ({
	source,
	constName
}: {
	source: string;
	constName: string;
}): number => {
	const match = source.match(new RegExp(`${constName}\\s*=\\s*(\\d+)`));

	if (!match) {
		throw new Error(`no integer literal for: ${constName}`);
	}

	return Number(match[1]);
};

/** The value of `<constName> = a * b * ...;`. A factor is an integer or a
 * named unit (`DAY_IN_MS`) the caller resolves through `units`, since the
 * app module that defines the unit cannot be imported from here. */
export const extractProductConst = ({
	source,
	constName,
	units = {}
}: {
	source: string;
	constName: string;
	units?: Record<string, number>;
}): number => {
	const factor = '(?:\\d+|[A-Z][A-Z0-9_]*)';
	const match = source.match(
		new RegExp(`${constName}\\s*=\\s*(${factor}(?:\\s*\\*\\s*${factor})*)\\s*;`)
	);

	if (!match || !match[1]) {
		throw new Error(`no integer product for: ${constName}`);
	}

	return match[1].split('*').reduce((acc, raw) => {
		const name = raw.trim();
		const value = /^\d+$/.test(name) ? Number(name) : units[name];

		if (isNullish(value)) {
			throw new Error(`unknown unit ${name} in: ${constName}`);
		}

		return acc * value;
	}, 1);
};

/** The single-quoted string literal of `<constName> = '...'`. */
export const extractStringConst = ({
	source,
	constName
}: {
	source: string;
	constName: string;
}): string => {
	const match = source.match(new RegExp(`${constName}\\s*=\\s*'([^']+)'`));

	if (!match || !match[1]) {
		throw new Error(`no string literal for: ${constName}`);
	}

	return match[1];
};
