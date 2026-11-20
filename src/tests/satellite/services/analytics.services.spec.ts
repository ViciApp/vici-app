import { Collection } from '#lib/constants/collections.constants.ts';
import type { AnalyticsEventDoc, TrackEventInput } from '#lib/types/analytics-event.ts';
import {
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { trackEventsFn } from '#satellite/services/analytics.services.ts';
import { nonNullish } from '@dfinity/utils';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const user = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));

const event = (overrides: Partial<TrackEventInput> = {}): TrackEventInput => ({
	name: 'market_viewed',
	sessionId: '7f1c2b3a-0000-4000-8000-000000000000',
	path: '/market/abc',
	marketId: 'abc',
	...overrides
});

describe('trackEventsFn', () => {
	let host: SatelliteHost;

	const stored = (): AnalyticsEventDoc[] =>
		host
			.keys(Collection.EVENTS)
			.map((key) => host.readDoc<AnalyticsEventDoc>({ collection: Collection.EVENTS, key }))
			.filter(nonNullish);

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	it('stores an anonymous visitor event without a principal', () => {
		host.setCaller(Principal.anonymous());

		assert.deepEqual(trackEventsFn({ events: [event()] }), { accepted: 1 });
		assert.equal(stored().length, 1);
		assert.equal(stored()[0]?.principal, undefined);
	});

	it('stores a signed-in event with the caller as principal', () => {
		host.setCaller(user);

		trackEventsFn({ events: [event()] });

		assert.equal(stored()[0]?.principal, user.toText());
	});

	it('does not store an event the server records itself', () => {
		host.setCaller(user);

		const result = trackEventsFn({
			events: [event({ name: 'vxp_awarded', value: 1_000_000 }), event({ name: 'payout_settled' })]
		});

		assert.deepEqual(result, { accepted: 0 });
		assert.deepEqual(stored(), []);
	});

	it('does not store an event with an oversized string', () => {
		const result = trackEventsFn({
			events: [
				event({ sessionId: 's'.repeat(129) }),
				event({ path: `/${'p'.repeat(2048)}` }),
				event({ label: 'l'.repeat(257) }),
				event()
			]
		});

		assert.deepEqual(result, { accepted: 1 });
		assert.equal(stored().length, 1);
	});

	it('stores at most one client batch per call', () => {
		const result = trackEventsFn({ events: Array.from({ length: 50 }, () => event()) });

		assert.deepEqual(result, { accepted: 20 });
		assert.equal(stored().length, 20);
	});
});
