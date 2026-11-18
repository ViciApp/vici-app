// Public profile lookup by account id. Accounts are keyed by uuid; the web2
// app can still hold an on-chain principal where an id is expected (the
// anonymous placeholder identity, a legacy owner), and such a lookup must read
// as absent instead of failing the uuid bind as a 500.

import { describe, expect, test } from 'bun:test';
import { app } from '../src/index';

describe('GET /api/v1/profiles/:userId', () => {
	test.each(['2vxsx-fae', 'not-a-uuid'])(
		'reads the non-uuid id %s as an absent profile',
		async (id) => {
			const res = await app.handle(new Request(`http://localhost/api/v1/profiles/${id}`));

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ profile: null });
		}
	);
});
