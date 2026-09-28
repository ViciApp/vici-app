// The test-only E2E stack (backend/e2e/): the boot guard that keeps it off
// anything but a disposable local environment, the fake engine's read-only
// contract, and the email transport seam its outbox rides on.

import { toNullable } from '@dfinity/utils';
import { afterEach, describe, expect, test } from 'bun:test';
import { fakeEngineActorProvider, fakeVxpLedgerProvider } from '../e2e/fake-engine';
import { E2E_LIVE_SERIES, E2E_SETTLED_SERIES } from '../e2e/fixtures';
import { assertE2eEnvironment, e2eEnvironmentProblems } from '../e2e/guard';
import { sendEmail, setEmailTransport, type EmailMessage } from '../src/lib/email';
import { engineReaderIcIdentity } from '../src/lib/keys';

const LOCAL_E2E_ENV = {
	NODE_ENV: 'test',
	VICI_E2E: '1',
	VXP_TREASURY_DISABLED: '1',
	DATABASE_URL: 'postgres://vici:vici@localhost:5432/vici',
	IC_HOST: 'http://127.0.0.1:9'
};

describe('E2E boot guard', () => {
	test('accepts a disposable local stack', () => {
		expect(e2eEnvironmentProblems(LOCAL_E2E_ENV)).toEqual([]);
		expect(() => assertE2eEnvironment(LOCAL_E2E_ENV)).not.toThrow();
	});

	test.each([
		['a production NODE_ENV', { NODE_ENV: 'production' }, 'NODE_ENV'],
		['a missing E2E flag', { VICI_E2E: undefined }, 'VICI_E2E'],
		['a live VXP treasury', { VXP_TREASURY_DISABLED: undefined }, 'VXP_TREASURY_DISABLED'],
		['a remote database', { DATABASE_URL: 'postgres://u:p@db.internal:5432/vici' }, 'DATABASE_URL'],
		['the mainnet IC host', { IC_HOST: undefined }, 'IC_HOST'],
		['a public IC host', { IC_HOST: 'https://icp-api.io' }, 'IC_HOST']
	])('refuses %s', (_label, override, variable) => {
		const source = { ...LOCAL_E2E_ENV, ...override };

		expect(e2eEnvironmentProblems(source).join(' ')).toContain(variable);
		expect(() => assertE2eEnvironment(source)).toThrow('Refusing to run the E2E stack');
	});
});

describe('fake engine', () => {
	const reader = engineReaderIcIdentity();

	test('serves the fixture catalog, tradeable filter included', async () => {
		const registry = await fakeEngineActorProvider.registry(reader, false);
		const all = await registry.list_series({ cursor: toNullable(), limit: toNullable() });
		const tradeable = await registry.list_series_with({
			strike: toNullable(),
			creator: toNullable(),
			payoff_type: toNullable(),
			payout_unit: toNullable(),
			tradeable_now: toNullable(true),
			pagination: toNullable(),
			underlying: toNullable(),
			only_unexpired: toNullable(),
			search_term: toNullable(),
			balance_domain: toNullable(),
			oracle_source: toNullable()
		});

		expect(all.items.map(({ series_id }) => series_id)).toEqual([
			...E2E_LIVE_SERIES.map(({ seriesId }) => seriesId),
			E2E_SETTLED_SERIES.seriesId
		]);
		expect(tradeable.items.map(({ series_id }) => series_id)).toEqual(
			E2E_LIVE_SERIES.map(({ seriesId }) => seriesId)
		);
	});

	test('reads every account as the never-deposited one', async () => {
		const clearing = await fakeEngineActorProvider.clearing(reader, true);

		expect(await clearing.get_account_state_query()).toEqual({
			Err: { NoAccountStateFound: null }
		});
	});

	test('rejects every method it does not serve, writes included', async () => {
		const clearing = await fakeEngineActorProvider.clearing(reader, true);

		await expect(clearing.cancel_limit_order({ order_id: 'o-1' })).rejects.toThrow(
			'cancel_limit_order is not served in the E2E stack'
		);
	});

	test('never transfers VXP', async () => {
		const ledger = await fakeVxpLedgerProvider();

		await expect(
			ledger.transfer({ to: { owner: reader.getPrincipal(), subaccount: [] }, amount: BigInt(1) })
		).rejects.toThrow('transfers are disabled');
	});
});

describe('email transport seam', () => {
	let restore: (() => void) | undefined;

	afterEach(() => {
		restore?.();
		restore = undefined;
	});

	test('routes every message through the installed transport', async () => {
		const sent: EmailMessage[] = [];
		const message = { to: 'a@vici-e2e.test', subject: 's', text: 't', html: '<p>t</p>' };

		restore = setEmailTransport((next) => {
			sent.push(next);

			return Promise.resolve();
		});

		await sendEmail(message);

		expect(sent).toEqual([message]);
	});
});
