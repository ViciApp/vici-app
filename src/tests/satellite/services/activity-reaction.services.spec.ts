import { Collection } from '#lib/constants/collections.constants.ts';
import { ActivityType } from '#lib/enums/social.ts';
import {
	controller,
	deleteContext,
	installSatelliteHost,
	type SatelliteHost
} from '#root/src/tests/mocks/satellite-host.mock.ts';
import { assertDeleteActivityReaction } from '#satellite/services/activity-reaction.services.ts';
import { Principal } from '@icp-sdk/core/principal';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const actor = Principal.fromUint8Array(new Uint8Array([2, 2, 2]));
const liker = Principal.fromUint8Array(new Uint8Array([3, 3, 3]));

const timestamp = 1_700_000_000_000;
const activityKey = `${actor.toText()}#${timestamp}#${ActivityType.TRADE}`;
const reactionKey = `${activityKey}#${liker.toText()}`;

describe('activity-reaction.services', () => {
	let host: SatelliteHost;

	beforeEach(() => {
		host = installSatelliteHost();
	});

	afterEach(() => host.restore());

	describe('assertDeleteActivityReaction', () => {
		const unlike = (caller: Principal) =>
			deleteContext({
				caller,
				collection: Collection.ACTIVITY_REACTIONS,
				key: reactionKey,
				current: {
					liker: liker.toText(),
					activityKey,
					timestamp,
					activityTitle: 'A call'
				},
				currentOwner: liker
			});

		it("rejects removing another user's like", () => {
			assert.throws(
				() => assertDeleteActivityReaction(unlike(actor)),
				/only the owner or the satellite/
			);
		});

		it('lets the liker and a satellite controller remove the like', () => {
			assert.doesNotThrow(() => assertDeleteActivityReaction(unlike(liker)));
			assert.doesNotThrow(() => assertDeleteActivityReaction(unlike(controller)));
		});
	});
});
