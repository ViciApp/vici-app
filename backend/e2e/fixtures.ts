// Deterministic fixture data for the end-to-end suite, shared by the
// backend side (fake engine + seed) and the Playwright specs under
// e2e/. Kept import-free so the Playwright runner can load it without
// the backend's dependency tree.
//
// Every address uses the reserved `.test` TLD, so nothing here can ever
// reach a real mailbox even if a transport were misconfigured.

export const E2E_EMAIL_DOMAIN = 'vici-e2e.test';

/** Seeded with the admin role; signs in through the real OTP flow to drive
 * the admin settings API (beta gate) from the specs. */
export const E2E_ADMIN_EMAIL = `admin@${E2E_EMAIL_DOMAIN}`;

/** The fake engine's series creator and oracle: data only, never called. */
export const E2E_CREATOR_PRINCIPAL =
	'n6e37-rydam-bqgay-dambq-gayda-mbqga-ydamb-qgayd-ambqg-aydam-bqe';

export const E2E_ORACLE_ID = 'VICI_ORACLE_V1';

export const E2E_ENGINE_ID = 'eng_0';

export interface E2eSeries {
	seriesId: string;
	title: string;
	description: string;
	/** Expiry as an ISO date; far future for live markets so the fixture never
	 * ages out, past for the settled one. */
	expiry: string;
	/** Present only on the settled series: the winning outcome. */
	settledOutcome?: 'YES' | 'NO';
}

export const E2E_LIVE_SERIES: E2eSeries[] = [
	{
		seriesId: 'e2e-series-comet',
		title: 'Will the E2E comet be visible from Rome?',
		description: 'Fixture market served by the end-to-end fake engine.',
		expiry: '2099-12-31T21:59:59.000Z'
	},
	{
		seriesId: 'e2e-series-harvest',
		title: 'Will the E2E harvest beat last season?',
		description: 'Fixture market served by the end-to-end fake engine.',
		expiry: '2099-06-30T21:59:59.000Z'
	},
	{
		seriesId: 'e2e-series-relay',
		title: 'Will the E2E relay team set a record?',
		description: 'Fixture market served by the end-to-end fake engine.',
		expiry: '2098-09-15T21:59:59.000Z'
	}
];

export const E2E_SETTLED_SERIES: E2eSeries = {
	seriesId: 'e2e-series-eclipse',
	title: 'Did the E2E eclipse happen on schedule?',
	description: 'Settled fixture market served by the end-to-end fake engine.',
	expiry: '2025-03-01T21:59:59.000Z',
	settledOutcome: 'YES'
};

export const E2E_ALL_SERIES: E2eSeries[] = [...E2E_LIVE_SERIES, E2E_SETTLED_SERIES];
