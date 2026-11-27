// handle_fold (Postgres, migration 0028) fills handle_key for rows the
// previous release writes and for the backfill; handleUniqueKey fills it for
// every write of this release. The two must agree on every input, or a
// lookalike slips past the check depending on who wrote the row.

import { beforeAll, describe, expect, test } from 'bun:test';
import { query } from '../src/db/client';
import { HANDLE_LETTER_FOLDS, handleUniqueKey } from '../src/profiles/nickname';
import { ensureMigrated } from './helpers/auth';
import { dbAvailable } from './helpers/setup';

const FIXTURES = [
	'antonioventilii',
	'antonio.ventilii',
	'Antonio_Ventilii',
	'antonioventílii',
	'José-María',
	'Müller99',
	'Ñandú',
	'Çelik',
	'İstanbul',
	'Ｆｕｌｌｗｉｄｔｈ',
	'ﬁnance',
	'東京tokyo',
	'Ελλάδα',
	'Москва',
	'🙂smile',
	'  spaced out  ',
	'@handle!',
	'',
	...HANDLE_LETTER_FOLDS.flatMap(([letter]) => [`a${letter}b`, `A${letter.toUpperCase()}B`]),
	'STRAẞE'
];

describe.if(dbAvailable)('handle_fold parity', () => {
	beforeAll(async () => {
		await ensureMigrated();
	});

	test('handle_fold equals handleUniqueKey for every fixture', async () => {
		const rows = await query<{ raw: string; folded: string }>(
			`select raw, handle_fold(raw) as folded from unnest($1::text[]) as raw`,
			[FIXTURES]
		);

		expect(rows.map(({ raw, folded }) => [raw, folded])).toEqual(
			FIXTURES.map((raw) => [raw, handleUniqueKey(raw)])
		);
	});
});
