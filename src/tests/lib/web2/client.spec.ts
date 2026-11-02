import {
	cancelEngineOrder,
	getEngineAccountState,
	listEngineSettlementStatuses,
	Web2ApiError
} from '$lib/web2/client';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

interface Call {
	url: string;
	method?: string;
	seriesIds: string[];
}

const wireStatus = (seriesId: string): Record<string, unknown> => ({
	status: { Finalised: null },
	series_id: seriesId,
	fee_usd: '1',
	accounting_cursor: '2',
	insurance_fee_usd: '3',
	accounting_applied: true,
	balance_domain: { ViciXp: null },
	oracle_source: 'oracle',
	total_positions: '4',
	settlement: { Outcome: 'YES' }
});

const ok = (settlements: Record<string, unknown>[]): Response =>
	new Response(JSON.stringify({ settlements }), { status: 200 });

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `s${i}`);

describe('listEngineSettlementStatuses', () => {
	const originalFetch = globalThis.fetch;
	const originalConsoleError = console.error;

	let calls: Call[];
	let open: number;
	let maxOpen: number;

	/** Answers each request through `respond`, tracking how many overlap. */
	const stubFetch = (respond: (call: Call & { index: number }) => Response): void => {
		globalThis.fetch = async (...[url, init]: Parameters<typeof fetch>): Promise<Response> => {
			const { seriesIds } = JSON.parse(String(init?.body)) as { seriesIds: string[] };
			const call = { url: String(url), method: init?.method, seriesIds };

			calls.push(call);
			open += 1;
			maxOpen = Math.max(maxOpen, open);

			await new Promise((resolve) => setImmediate(resolve));

			open -= 1;

			return respond({ ...call, index: calls.length - 1 });
		};
	};

	beforeEach(() => {
		calls = [];
		open = 0;
		maxOpen = 0;
		console.error = mock.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		console.error = originalConsoleError;
	});

	it('sends no request for an empty set', async () => {
		stubFetch(() => ok([]));

		assert.deepEqual(await listEngineSettlementStatuses([]), []);
		assert.equal(calls.length, 0);
	});

	it('splits at the route cap and never overlaps two requests', async () => {
		stubFetch(({ seriesIds }) => ok(seriesIds.map(wireStatus)));

		const seriesIds = ids(1144);
		const statuses = await listEngineSettlementStatuses(seriesIds);

		assert.equal(calls.length, 12);
		assert.deepEqual(
			calls.map((call) => call.seriesIds.length),
			[...new Array<number>(11).fill(100), 44]
		);
		assert.equal(maxOpen, 1);
		assert.deepEqual(
			statuses.map(({ series_id }) => series_id),
			seriesIds
		);
	});

	it('posts to the bulk route', async () => {
		stubFetch(() => ok([]));

		await listEngineSettlementStatuses(['s0']);

		assert.equal(calls[0]?.method, 'POST');
		assert.ok(calls[0]?.url.endsWith('/api/v1/engine/series/settlements'));
	});

	it('maps each wire view back to the candid shape', async () => {
		stubFetch(() => ok([wireStatus('s0')]));

		const [status] = await listEngineSettlementStatuses(['s0']);

		assert.equal(status?.fee_usd, BigInt(1));
		assert.equal(status?.total_positions, BigInt(4));
		assert.deepEqual(status?.settlement, { Outcome: 'YES' });
	});

	it('fails open per request: a failed one costs only its own series', async () => {
		stubFetch(({ seriesIds, index }) =>
			index === 1 ? new Response('{}', { status: 502 }) : ok(seriesIds.map(wireStatus))
		);

		const statuses = await listEngineSettlementStatuses(ids(250));

		assert.equal(calls.length, 3);
		assert.equal(statuses.length, 150);
		assert.equal(statuses[99]?.series_id, 's99');
		assert.equal(statuses[100]?.series_id, 's200');
		assert.equal((console.error as unknown as ReturnType<typeof mock.fn>).mock.callCount(), 1);
	});

	it('survives a request that never reaches the API', async () => {
		stubFetch(() => {
			throw new TypeError('network down');
		});

		assert.deepEqual(await listEngineSettlementStatuses(ids(150)), []);
		assert.equal(calls.length, 2);
	});
});

describe('getEngineAccountState', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('asks for the figures of the requested balance domain', async () => {
		const urls: string[] = [];

		globalThis.fetch = (...[url]: Parameters<typeof fetch>): Promise<Response> => {
			urls.push(String(url));

			return Promise.resolve(
				new Response(
					JSON.stringify({
						account: {
							assets: [],
							state: {
								user: '2vxsx-fae',
								reserved_margins_usd: [],
								cash_balances_usd: [],
								balances: []
							},
							total_equity_usd: '7',
							available_margin_usd: '5'
						}
					}),
					{ status: 200 }
				)
			);
		};

		const account = await getEngineAccountState({ ViciXp: null });

		assert.equal(urls.length, 1);
		assert.ok(urls[0].endsWith('/api/v1/engine/account?domain=ViciXp'));
		assert.equal(account.total_equity_usd, 7n);
		assert.equal(account.available_margin_usd, 5n);
	});
});

describe('Web2ApiError', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const refusal = async ({
		status,
		body
	}: {
		status: number;
		body: string;
	}): Promise<Web2ApiError> => {
		globalThis.fetch = () => Promise.resolve(new Response(body, { status }));

		const err: unknown = await cancelEngineOrder({ orderId: 'o1' }).catch((e: unknown) => e);

		assert.ok(err instanceof Web2ApiError);

		return err;
	};

	it('carries the code and amounts of an order refusal', async () => {
		const { status, code, amounts } = await refusal({
			status: 400,
			body: JSON.stringify({ error: 'insufficient_balance', available: '15', required: '20' })
		});

		assert.equal(status, 400);
		assert.equal(code, 'insufficient_balance');
		assert.deepEqual(amounts, { available: '15', required: '20' });
	});

	it('drops amounts that are not wire bigints', async () => {
		for (const available of ['1.5', 'abc', 15, undefined]) {
			const { amounts } = await refusal({
				status: 400,
				body: JSON.stringify({ error: 'insufficient_balance', available, required: '20' })
			});

			assert.equal(amounts, undefined);
		}
	});

	it('keeps the generic code for a body that is not the envelope', async () => {
		const { code } = await refusal({ status: 502, body: '<html>bad gateway</html>' });

		assert.equal(code, 'unknown_error');
	});
});
