// Shared plumbing for the cutover scripts: the CSV the team fills in (one
// header, read back by column name) and the argv flags every script takes.

import { isNullish, nonNullish } from '@dfinity/utils';

/** The columns of the unmatched-accounts sheet, in order. `email` is the one
 * the team fills in; assign-emails reads back `user_id` and `email` only. */
export const UNMATCHED_CSV_COLUMNS = [
	'user_id',
	'handle',
	'display_name',
	'legacy_principals',
	'legacy_provider',
	'school',
	'known_email',
	'email'
] as const;

export type UnmatchedCsvColumn = (typeof UNMATCHED_CSV_COLUMNS)[number];

// A spreadsheet runs a cell that starts with one of these as a formula, and
// handles and display names are user-written: prefixing the quote keeps the
// sheet the team opens inert.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

const csvCell = (value: string): string => {
	const inert = FORMULA_LEAD.test(value) ? `'${value}` : value;

	return /[",\r\n]/.test(inert) || inert !== inert.trim()
		? `"${inert.replaceAll('"', '""')}"`
		: inert;
};

/** RFC 4180 text for a header plus rows, CRLF line endings. */
export const formatCsv = ({
	header,
	rows
}: {
	header: readonly string[];
	rows: ReadonlyArray<readonly string[]>;
}): string => `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

const BYTE_ORDER_MARK = '\uFEFF';

// One field (quoted, with doubled quotes inside, or bare) and what ends it: a
// comma, a line break, or the end of the text. Sticky, so a field the pattern
// cannot read (a quote left open, a quote inside a bare field) stops the parse
// instead of being skipped.
const CSV_FIELD = /("(?:[^"]|"")*"|[^,"\r\n]*)(,|\r?\n|$)/y;

const unquote = (field: string): string =>
	field.startsWith('"') ? field.slice(1, -1).replaceAll('""', '"') : field;

/** Parses RFC 4180 text into string cells per line: quoted fields may hold
 * commas, doubled quotes and line breaks; LF or CRLF line endings; a leading
 * byte-order mark (what spreadsheet exports write) is dropped. */
export const parseCsvRows = (text: string): string[][] => {
	const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let separator: string | undefined;

	CSV_FIELD.lastIndex = 0;

	while (separator !== '') {
		const offset = CSV_FIELD.lastIndex;
		const match = CSV_FIELD.exec(source);

		if (isNullish(match)) {
			throw new Error(`csv: malformed field at offset ${offset}`);
		}

		row.push(unquote(match[1] ?? ''));
		separator = match[2] ?? '';

		if (separator !== ',') {
			rows.push(row);
			row = [];
		}
	}

	// A blank line (an empty single cell) carries nothing.
	return rows.filter((cells) => cells.length > 1 || cells[0] !== '');
};

/** One data row of a parsed sheet: its 1-based line in the file (the header
 * is line 1) and its cells keyed by header name. */
export interface CsvRecord {
	line: number;
	cells: Record<string, string>;
}

/** Parses a sheet with a header row into records, refusing one that lacks a
 * `required` column. */
export const parseCsvRecords = ({
	text,
	required
}: {
	text: string;
	required: readonly string[];
}): CsvRecord[] => {
	const [header, ...data] = parseCsvRows(text);
	const names = (header ?? []).map((name) => name.trim());
	const missing = required.filter((name) => !names.includes(name));

	if (missing.length > 0) {
		throw new Error(`csv: missing column(s) ${missing.join(', ')}`);
	}

	return data.map((cells, index) => ({
		line: index + 2,
		cells: Object.fromEntries(names.map((name, column) => [name, cells[column] ?? '']))
	}));
};

/** Whether `flag` is on the command line. */
export const hasFlag = ({ argv, flag }: { argv: readonly string[]; flag: string }): boolean =>
	argv.includes(flag);

/** Every value given after `flag` (`--flag a --flag b`). */
export const flagValues = ({ argv, flag }: { argv: readonly string[]; flag: string }): string[] =>
	argv.flatMap((arg, i) => {
		const next = argv[i + 1];

		return arg === flag && nonNullish(next) ? [next] : [];
	});

/** The arguments that are neither a flag nor a flag's value. `valued` names
 * the flags that take a value. */
export const positionalArgs = ({
	argv,
	valued
}: {
	argv: readonly string[];
	valued: readonly string[];
}): string[] =>
	argv.filter((arg, i) => !arg.startsWith('--') && !valued.includes(argv[i - 1] ?? ''));

/** The warning every email-related cutover step prints: the drain rewrites
 * the column assign-emails fills. */
export const DRAIN_WIPES_ASSIGNED_EMAILS_WARNING = [
	'!! etl:drain-auth overwrites legacy_auth_identities.profile_email with what the',
	'!! legacy satellite holds (nothing, for passkey and Internet Identity logins).',
	'!! Run cutover:assign-emails AFTER the final etl:drain-auth, and run it again',
	'!! (same file, it is idempotent) after any later drain.'
].join('\n');
